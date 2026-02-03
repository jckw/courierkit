import { describe, expect, test } from 'bun:test';
import { createEntitlements } from '../src/entitlements.js';
import type { Adapter, Entitlement, Interval } from '../src/types.js';

// Mock adapter for testing
function createMockAdapter(config: {
	entitlements: Record<string, Record<string, Entitlement>>;
	usage: Record<string, Record<string, number>>;
}): Adapter {
	return {
		async getEntitlements(actorId: string) {
			return config.entitlements[actorId] || {};
		},
		async getUsage(actorId: string, action: string, _interval: Interval) {
			return config.usage[actorId]?.[action] || 0;
		},
	};
}

describe('Entitlements Engine', () => {
	describe('check', () => {
		test('allows action when entitlement exists and under limit', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 50 },
				},
			});

			const engine = createEntitlements({ adapter });
			const decision = await engine.check({ actorId: 'user1', action: 'api-calls' });

			expect(decision.outcome.allowed).toBe(true);
			expect(decision.reasons[0].outcome).toBe('allow');
		});

		test('respects at override when resolving windows', async () => {
			let receivedInterval: Interval | null = null;
			const adapter: Adapter = {
				async getEntitlements() {
					return {
						'api-calls': {
							limit: 10,
							window: { type: 'calendar', unit: 'day', timezone: 'UTC' },
						},
					};
				},
				async getUsage(_actorId, _action, interval) {
					receivedInterval = interval;
					return 0;
				},
			};

			const engine = createEntitlements({ adapter });
			const at = new Date('2024-01-15T12:34:00Z');
			await engine.check({ actorId: 'user1', action: 'api-calls', at });

			expect(receivedInterval?.start.toISOString()).toBe('2024-01-15T00:00:00.000Z');
		});

		test('denies action when no entitlement exists', async () => {
			const adapter = createMockAdapter({
				entitlements: { user1: {} },
				usage: {},
			});

			const engine = createEntitlements({ adapter });
			const decision = await engine.check({ actorId: 'user1', action: 'unknown-action' });

			expect(decision.outcome.allowed).toBe(false);
			expect(decision.reasons[0].explanation).toContain('No entitlement defined');
		});

		test('denies action when limit exceeded', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 100 },
				},
			});

			const engine = createEntitlements({ adapter });
			const decision = await engine.check({ actorId: 'user1', action: 'api-calls' });

			expect(decision.outcome.allowed).toBe(false);
			expect(decision.reasons[0].outcome).toBe('deny');
		});

		test('allows unlimited actions', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: null, window: null },
					},
				},
				usage: {
					user1: { 'api-calls': 1000000 },
				},
			});

			const engine = createEntitlements({ adapter });
			const decision = await engine.check({ actorId: 'user1', action: 'api-calls' });

			expect(decision.outcome.allowed).toBe(true);
		});

		test('returns consume obligation when allowed', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 50 },
				},
			});

			const engine = createEntitlements({ adapter });
			const decision = await engine.check({ actorId: 'user1', action: 'api-calls' });

			expect(decision.obligations).toHaveLength(1);
			expect(decision.obligations[0]).toEqual({
				type: 'consume',
				params: { amount: 1 },
			});
		});

		test('uses custom consume amount', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 95 },
				},
			});

			const engine = createEntitlements({ adapter });

			// Should deny consuming 10 when only 5 left
			const decision = await engine.check({ actorId: 'user1', action: 'api-calls', consume: 10 });
			expect(decision.outcome.allowed).toBe(false);

			// Should allow consuming 5
			const decision2 = await engine.check({ actorId: 'user1', action: 'api-calls', consume: 5 });
			expect(decision2.outcome.allowed).toBe(true);
		});
	});

	describe('capabilities', () => {
		test('returns capabilities for multiple actions', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
						export: { limit: 10, window: { type: 'calendar', unit: 'day' } },
						premium: { limit: null, window: null },
					},
				},
				usage: {
					user1: {
						'api-calls': 50,
						export: 10,
						premium: 0,
					},
				},
			});

			const engine = createEntitlements({ adapter });
			const caps = await engine.capabilities({
				actorId: 'user1',
				actions: ['api-calls', 'export', 'premium', 'unknown'],
			});

			// api-calls is available
			expect(caps.actions['api-calls'].status).toBe('available');

			// export is exhausted
			expect(caps.actions['export'].status).toBe('exhausted');

			// premium is available (unlimited)
			expect(caps.actions['premium'].status).toBe('available');

			// unknown is unavailable
			expect(caps.actions['unknown'].status).toBe('unavailable');

			// Summary
			expect(caps.summary.available).toContain('api-calls');
			expect(caps.summary.available).toContain('premium');
			expect(caps.summary.exhausted).toContain('export');
			expect(caps.summary.unavailable).toContain('unknown');
		});

		test('includes quota state for exhausted actions', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						export: { limit: 10, window: { type: 'calendar', unit: 'day' } },
					},
				},
				usage: {
					user1: { export: 10 },
				},
			});

			const engine = createEntitlements({ adapter });
			const caps = await engine.capabilities({
				actorId: 'user1',
				actions: ['export'],
			});

			const exportCap = caps.actions['export'];
			expect(exportCap.status).toBe('exhausted');

			if (exportCap.status === 'exhausted') {
				expect(exportCap.quota.limit).toBe(10);
				expect(exportCap.quota.used).toBe(10);
				expect(exportCap.quota.remaining).toBe(0);
				expect(exportCap.availableAt).not.toBeNull();
			}
		});

		test('includes obligations for available actions', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 50 },
				},
			});

			const engine = createEntitlements({ adapter });
			const caps = await engine.capabilities({
				actorId: 'user1',
				actions: ['api-calls'],
			});

			const cap = caps.actions['api-calls'];
			expect(cap.status).toBe('available');

			if (cap.status === 'available') {
				expect(cap.obligations).toHaveLength(1);
				expect(cap.obligations[0].type).toBe('consume');
			}
		});
	});

	describe('availableAt', () => {
		test('returns now when under limit', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 50 },
				},
			});

			const engine = createEntitlements({ adapter });
			const availability = await engine.availableAt({ actorId: 'user1', action: 'api-calls' });

			expect(availability.status).toBe('now');
		});

		test('returns at time when limit reached', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 100 },
				},
			});

			const engine = createEntitlements({ adapter });
			const availability = await engine.availableAt({ actorId: 'user1', action: 'api-calls' });

			expect(availability.status).toBe('at');
			if (availability.status === 'at') {
				expect(availability.at).toBeInstanceOf(Date);
			}
		});

		test('returns never when no entitlement', async () => {
			const adapter = createMockAdapter({
				entitlements: { user1: {} },
				usage: {},
			});

			const engine = createEntitlements({ adapter });
			const availability = await engine.availableAt({ actorId: 'user1', action: 'unknown' });

			expect(availability.status).toBe('never');
		});

		test('returns never for lifetime limit reached', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						trial: { limit: 1, window: { type: 'lifetime' } },
					},
				},
				usage: {
					user1: { trial: 1 },
				},
			});

			const engine = createEntitlements({ adapter });
			const availability = await engine.availableAt({ actorId: 'user1', action: 'trial' });

			expect(availability.status).toBe('never');
		});
	});

	describe('remainingUses', () => {
		test('returns remaining count', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
					},
				},
				usage: {
					user1: { 'api-calls': 30 },
				},
			});

			const engine = createEntitlements({ adapter });
			const remaining = await engine.remainingUses({ actorId: 'user1', action: 'api-calls' });

			expect(remaining.uses).toBe(70);
			expect(remaining.limitedBy).toBe('api-calls');
		});

		test('returns null uses for unlimited', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: null, window: null },
					},
				},
				usage: {},
			});

			const engine = createEntitlements({ adapter });
			const remaining = await engine.remainingUses({ actorId: 'user1', action: 'api-calls' });

			expect(remaining.uses).toBeNull();
			expect(remaining.limitedBy).toBeNull();
		});

		test('returns 0 for no entitlement', async () => {
			const adapter = createMockAdapter({
				entitlements: { user1: {} },
				usage: {},
			});

			const engine = createEntitlements({ adapter });
			const remaining = await engine.remainingUses({ actorId: 'user1', action: 'unknown' });

			expect(remaining.uses).toBe(0);
			expect(remaining.limitedBy).toBe('no-entitlement');
		});
	});

	describe('dashboard', () => {
		test('returns all quota states for an actor', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'month' } },
						export: { limit: 10, window: { type: 'calendar', unit: 'day' } },
						premium: { limit: null, window: null },
					},
				},
				usage: {
					user1: {
						'api-calls': 50,
						export: 8,
						premium: 100,
					},
				},
			});

			const engine = createEntitlements({ adapter });
			const dash = await engine.dashboard({ actorId: 'user1' });

			expect(Object.keys(dash.quotas)).toHaveLength(3);

			// api-calls quota
			expect(dash.quotas['api-calls'].name).toBe('api-calls');
			expect(dash.quotas['api-calls'].limit).toBe(100);
			expect(dash.quotas['api-calls'].used).toBe(50);
			expect(dash.quotas['api-calls'].remaining).toBe(50);

			// export quota
			expect(dash.quotas['export'].limit).toBe(10);
			expect(dash.quotas['export'].used).toBe(8);
			expect(dash.quotas['export'].remaining).toBe(2);

			// premium (unlimited)
			expect(dash.quotas['premium'].limit).toBeNull();
			expect(dash.quotas['premium'].remaining).toBeNull();
		});

		test('includes reset times for windowed quotas', async () => {
			const adapter = createMockAdapter({
				entitlements: {
					user1: {
						'api-calls': { limit: 100, window: { type: 'calendar', unit: 'day' } },
					},
				},
				usage: {
					user1: { 'api-calls': 50 },
				},
			});

			const engine = createEntitlements({ adapter });
			const dash = await engine.dashboard({ actorId: 'user1' });

			expect(dash.quotas['api-calls'].resetsAt).toBeInstanceOf(Date);
			expect(dash.quotas['api-calls'].interval).not.toBeNull();
		});

		test('handles empty entitlements', async () => {
			const adapter = createMockAdapter({
				entitlements: { user1: {} },
				usage: {},
			});

			const engine = createEntitlements({ adapter });
			const dash = await engine.dashboard({ actorId: 'user1' });

			expect(Object.keys(dash.quotas)).toHaveLength(0);
		});
	});
});
