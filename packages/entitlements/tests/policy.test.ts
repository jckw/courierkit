import { describe, expect, test } from 'bun:test';
import {
	evaluate,
	createPolicy,
	createRule,
	allow,
	deny,
	skip,
	resolveAllMustAllow,
	resolveAnyMustAllow,
} from '../src/policy.js';
import type { FactDefinition, Rule, RuleResult } from '../src/types.js';

describe('Policy Evaluation', () => {
	describe('fact loading', () => {
		test('loads simple facts', async () => {
			const policy = createPolicy({
				facts: {
					user: {
						name: 'user',
						load: (input) => ({ id: input.userId, name: 'Test User' }),
					},
				},
				rules: [],
				resolve: () => ({ success: true }),
			});

			const decision = await evaluate(policy, { userId: '123' });
			expect(decision.trace.facts.user).toEqual({ id: '123', name: 'Test User' });
		});

		test('loads facts with dependencies in order', async () => {
			const loadOrder: string[] = [];

			const policy = createPolicy({
				facts: {
					user: {
						name: 'user',
						load: () => {
							loadOrder.push('user');
							return { id: '123' };
						},
					},
					plan: {
						name: 'plan',
						depends: ['user'],
						load: (_, facts) => {
							loadOrder.push('plan');
							return { userId: (facts.user as { id: string }).id, tier: 'pro' };
						},
					},
					usage: {
						name: 'usage',
						depends: ['plan'],
						load: (_, facts) => {
							loadOrder.push('usage');
							return { count: 5, tier: (facts.plan as { tier: string }).tier };
						},
					},
				},
				rules: [],
				resolve: () => ({ success: true }),
			});

			await evaluate(policy, {});
			expect(loadOrder).toEqual(['user', 'plan', 'usage']);
		});

		test('throws on circular dependencies', async () => {
			const policy = createPolicy({
				facts: {
					a: { name: 'a', depends: ['b'], load: () => 'a' },
					b: { name: 'b', depends: ['a'], load: () => 'b' },
				},
				rules: [],
				resolve: () => ({}),
			});

			await expect(evaluate(policy, {})).rejects.toThrow('Circular dependency');
		});

		test('throws on missing dependency', async () => {
			const policy = createPolicy({
				facts: {
					a: { name: 'a', depends: ['nonexistent'], load: () => 'a' },
				},
				rules: [],
				resolve: () => ({}),
			});

			await expect(evaluate(policy, {})).rejects.toThrow('unknown fact');
		});
	});

	describe('rule evaluation', () => {
		test('evaluates all rules', async () => {
			const policy = createPolicy({
				facts: {},
				rules: [
					createRule({ id: 'rule1', description: 'First rule', evaluate: () => allow('ok') }),
					createRule({ id: 'rule2', description: 'Second rule', evaluate: () => allow('ok') }),
					createRule({ id: 'rule3', description: 'Third rule', evaluate: () => deny('nope') }),
				],
				resolve: () => ({ done: true }),
			});

			const decision = await evaluate(policy, {});
			expect(decision.reasons).toHaveLength(3);
			expect(decision.reasons[0].rule).toBe('rule1');
			expect(decision.reasons[1].rule).toBe('rule2');
			expect(decision.reasons[2].rule).toBe('rule3');
		});

		test('passes facts and input to rules', async () => {
			interface TestFacts {
				multiplier: number;
			}

			const policy = createPolicy<{ result: number }, TestFacts>({
				facts: {
					multiplier: { name: 'multiplier', load: (input) => Number(input.value) * 2 },
				},
				rules: [
					createRule<TestFacts>({
						id: 'compute',
						description: 'Compute result',
						evaluate: (facts) => {
							return allow(`multiplied: ${facts.multiplier}`);
						},
					}),
				],
				resolve: (_, __, facts) => ({ result: facts.multiplier }),
			});

			const decision = await evaluate(policy, { value: 5 });
			expect(decision.outcome.result).toBe(10);
			expect(decision.reasons[0].explanation).toBe('multiplied: 10');
		});

		test('collects reasons with outcomes', async () => {
			const policy = createPolicy({
				facts: {},
				rules: [
					createRule({ id: 'allow-rule', description: 'Allow', evaluate: () => allow('allowed') }),
					createRule({ id: 'deny-rule', description: 'Deny', evaluate: () => deny('denied') }),
					createRule({ id: 'skip-rule', description: 'Skip', evaluate: () => skip('skipped') }),
				],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});

			expect(decision.reasons[0].outcome).toBe('allow');
			expect(decision.reasons[0].explanation).toBe('allowed');

			expect(decision.reasons[1].outcome).toBe('deny');
			expect(decision.reasons[1].explanation).toBe('denied');

			expect(decision.reasons[2].outcome).toBe('skip');
			expect(decision.reasons[2].explanation).toBe('skipped');
		});
	});

	describe('obligations', () => {
		test('collects obligations from allow results', async () => {
			const policy = createPolicy({
				facts: {},
				rules: [
					createRule({
						id: 'rule1',
						description: 'Rule 1',
						evaluate: () =>
							allow('ok', [
								{ type: 'consume', params: { amount: 1 } },
								{ type: 'log', params: { event: 'action' } },
							]),
					}),
					createRule({
						id: 'rule2',
						description: 'Rule 2',
						evaluate: () => allow('ok', [{ type: 'notify', params: { channel: 'slack' } }]),
					}),
				],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});

			expect(decision.obligations).toHaveLength(3);
			expect(decision.obligations[0].type).toBe('consume');
			expect(decision.obligations[1].type).toBe('log');
			expect(decision.obligations[2].type).toBe('notify');
		});

		test('does not collect obligations from deny or skip results', async () => {
			const policy = createPolicy({
				facts: {},
				rules: [
					createRule({ id: 'deny-rule', description: 'Deny', evaluate: () => deny('denied') }),
					createRule({ id: 'skip-rule', description: 'Skip', evaluate: () => skip('skipped') }),
				],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});
			expect(decision.obligations).toHaveLength(0);
		});
	});

	describe('resolution strategies', () => {
		describe('resolveAllMustAllow', () => {
			test('allows when all rules allow', () => {
				const results: RuleResult[] = [
					{ outcome: 'allow', explanation: 'ok' },
					{ outcome: 'allow', explanation: 'ok' },
					{ outcome: 'skip', explanation: 'n/a' },
				];

				expect(resolveAllMustAllow(results)).toEqual({ allowed: true });
			});

			test('denies when any rule denies', () => {
				const results: RuleResult[] = [
					{ outcome: 'allow', explanation: 'ok' },
					{ outcome: 'deny', explanation: 'nope' },
					{ outcome: 'allow', explanation: 'ok' },
				];

				expect(resolveAllMustAllow(results)).toEqual({ allowed: false });
			});

			test('allows with empty results', () => {
				expect(resolveAllMustAllow([])).toEqual({ allowed: true });
			});
		});

		describe('resolveAnyMustAllow', () => {
			test('allows when any rule allows', () => {
				const results: RuleResult[] = [
					{ outcome: 'deny', explanation: 'nope' },
					{ outcome: 'allow', explanation: 'ok' },
					{ outcome: 'deny', explanation: 'nope' },
				];

				expect(resolveAnyMustAllow(results)).toEqual({ allowed: true });
			});

			test('denies when no rule allows', () => {
				const results: RuleResult[] = [
					{ outcome: 'deny', explanation: 'nope' },
					{ outcome: 'skip', explanation: 'n/a' },
				];

				expect(resolveAnyMustAllow(results)).toEqual({ allowed: false });
			});

			test('denies with empty results', () => {
				expect(resolveAnyMustAllow([])).toEqual({ allowed: false });
			});
		});
	});

	describe('trace', () => {
		test('includes evaluation timestamp', async () => {
			const before = new Date();

			const policy = createPolicy({
				facts: {},
				rules: [],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});
			const after = new Date();

			expect(decision.trace.evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(decision.trace.evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		test('includes duration', async () => {
			const policy = createPolicy({
				facts: {
					slow: {
						name: 'slow',
						load: async () => {
							await new Promise((r) => setTimeout(r, 10));
							return 'done';
						},
					},
				},
				rules: [],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});
			expect(decision.trace.durationMs).toBeGreaterThanOrEqual(10);
		});

		test('includes fact snapshot', async () => {
			const policy = createPolicy({
				facts: {
					user: { name: 'user', load: () => ({ id: '123' }) },
					plan: { name: 'plan', load: () => ({ tier: 'pro' }) },
				},
				rules: [],
				resolve: () => ({}),
			});

			const decision = await evaluate(policy, {});
			expect(decision.trace.facts).toEqual({
				user: { id: '123' },
				plan: { tier: 'pro' },
			});
		});
	});

	describe('result helpers', () => {
		test('allow creates allow result', () => {
			expect(allow('reason')).toEqual({ outcome: 'allow', explanation: 'reason' });
		});

		test('allow with obligations', () => {
			const obligations = [{ type: 'consume', params: { amount: 1 } }];
			expect(allow('reason', obligations)).toEqual({
				outcome: 'allow',
				explanation: 'reason',
				obligations,
			});
		});

		test('deny creates deny result', () => {
			expect(deny('reason')).toEqual({ outcome: 'deny', explanation: 'reason' });
		});

		test('skip creates skip result', () => {
			expect(skip('reason')).toEqual({ outcome: 'skip', explanation: 'reason' });
		});
	});
});
