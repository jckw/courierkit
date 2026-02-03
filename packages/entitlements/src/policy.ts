/**
 * Policy evaluation engine.
 */

import type {
	Decision,
	EvaluateInput,
	FactDefinition,
	Obligation,
	Policy,
	Reason,
	Rule,
	RuleResult,
	Trace,
} from './types.js';

// ============================================================================
// Fact Loading
// ============================================================================

/**
 * Topologically sort fact definitions based on dependencies.
 */
function topologicalSort(facts: Record<string, FactDefinition>): string[] {
	const result: string[] = [];
	const visited = new Set<string>();
	const visiting = new Set<string>();

	function visit(name: string) {
		if (visited.has(name)) return;
		if (visiting.has(name)) {
			throw new Error(`Circular dependency detected involving fact: ${name}`);
		}

		visiting.add(name);
		const fact = facts[name];
		if (fact?.depends) {
			for (const dep of fact.depends) {
				if (!facts[dep]) {
					throw new Error(`Fact "${name}" depends on unknown fact "${dep}"`);
				}
				visit(dep);
			}
		}
		visiting.delete(name);
		visited.add(name);
		result.push(name);
	}

	for (const name of Object.keys(facts)) {
		visit(name);
	}

	return result;
}

/**
 * Load all facts in dependency order.
 */
async function loadFacts(
	factDefs: Record<string, FactDefinition>,
	input: EvaluateInput
): Promise<Record<string, unknown>> {
	const order = topologicalSort(factDefs);
	const facts: Record<string, unknown> = {};

	for (const name of order) {
		const def = factDefs[name];
		facts[name] = await def.load(input, facts);
	}

	return facts;
}

// ============================================================================
// Rule Evaluation
// ============================================================================

/**
 * Evaluate all rules and collect results.
 */
async function evaluateRules(
	rules: Rule[],
	facts: Record<string, unknown>,
	input: EvaluateInput
): Promise<{ results: RuleResult[]; reasons: Reason[] }> {
	const results: RuleResult[] = [];
	const reasons: Reason[] = [];

	for (const rule of rules) {
		const result = await rule.evaluate(facts, input);
		results.push(result);
		reasons.push({
			rule: rule.id,
			outcome: result.outcome,
			explanation: result.explanation,
		});
	}

	return { results, reasons };
}

/**
 * Collect obligations from all allow results.
 */
function collectObligations(results: RuleResult[]): Obligation[] {
	const obligations: Obligation[] = [];

	for (const result of results) {
		if (result.outcome === 'allow' && result.obligations) {
			obligations.push(...result.obligations);
		}
	}

	return obligations;
}

// ============================================================================
// Policy Evaluation
// ============================================================================

/**
 * Evaluate a policy with the given input.
 *
 * @param policy - The policy to evaluate
 * @param input - The evaluation input
 * @returns The decision
 */
export async function evaluate<TOutcome, TFacts, TInput extends EvaluateInput>(
	policy: Policy<TOutcome, TFacts, TInput>,
	input: TInput
): Promise<Decision<TOutcome>> {
	const startTime = performance.now();
	const evaluatedAt = new Date();

	// Step 1: Load facts
	const facts = await loadFacts(policy.facts, input);

	// Step 2: Evaluate rules
	const { results, reasons } = await evaluateRules(
		policy.rules as Rule[],
		facts,
		input
	);

	// Step 3: Resolve outcome
	const outcome = policy.resolve(results, input, facts as TFacts);

	// Step 4: Collect obligations
	const obligations = collectObligations(results);

	// Step 5: Build trace
	const trace: Trace = {
		evaluatedAt,
		durationMs: performance.now() - startTime,
		facts,
	};

	// Step 6: Return decision
	return {
		outcome,
		reasons,
		obligations,
		trace,
	};
}

// ============================================================================
// Common Resolution Strategies
// ============================================================================

/**
 * Resolution strategy: All rules must allow (any deny = denied).
 * This is the typical entitlements strategy.
 */
export function resolveAllMustAllow(results: RuleResult[]): { allowed: boolean } {
	const denied = results.some((r) => r.outcome === 'deny');
	return { allowed: !denied };
}

/**
 * Resolution strategy: Any rule must allow (any allow = allowed).
 * Useful for OR logic in feature flags.
 */
export function resolveAnyMustAllow(results: RuleResult[]): { allowed: boolean } {
	const allowed = results.some((r) => r.outcome === 'allow');
	return { allowed };
}

/**
 * Resolution strategy: Weighted scoring.
 * Sum weights from allow results.
 */
export function createWeightedResolver(
	weights: Record<string, number>
): (results: RuleResult[], _input: EvaluateInput, _facts: Record<string, unknown>) => { score: number } {
	return (results) => {
		let score = 0;
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.outcome === 'allow') {
				// Would need rule ID here; for now just count
				score += 1;
			}
		}
		return { score };
	};
}

// ============================================================================
// Policy Builder
// ============================================================================

/**
 * Create a policy with type inference.
 */
export function createPolicy<
	TOutcome,
	TFacts extends Record<string, unknown> = Record<string, unknown>,
	TInput extends EvaluateInput = EvaluateInput,
>(config: {
	facts: Record<string, FactDefinition>;
	rules: Rule<TFacts, TInput>[];
	resolve: (results: RuleResult[], input: TInput, facts: TFacts) => TOutcome;
}): Policy<TOutcome, TFacts, TInput> {
	return config;
}

// ============================================================================
// Rule Helpers
// ============================================================================

/**
 * Create a rule with type inference.
 */
export function createRule<
	TFacts extends Record<string, unknown> = Record<string, unknown>,
	TInput extends Record<string, unknown> = Record<string, unknown>,
>(config: {
	id: string;
	description: string;
	evaluate: (facts: TFacts, input: TInput) => RuleResult | Promise<RuleResult>;
}): Rule<TFacts, TInput> {
	return config;
}

/**
 * Create an allow result.
 */
export function allow(explanation: string, obligations?: Obligation[]): RuleResult {
	return { outcome: 'allow', explanation, obligations };
}

/**
 * Create a deny result.
 */
export function deny(explanation: string): RuleResult {
	return { outcome: 'deny', explanation };
}

/**
 * Create a skip result.
 */
export function skip(explanation: string): RuleResult {
	return { outcome: 'skip', explanation };
}
