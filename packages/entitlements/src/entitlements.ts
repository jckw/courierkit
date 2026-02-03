/**
 * High-level entitlement queries.
 */

import type {
	ActionCapability,
	Adapter,
	Availability,
	Capabilities,
	Dashboard,
	Decision,
	Entitlement,
	Obligation,
	QuotaState,
	RemainingUses,
	RuleResult,
} from './types.js';
import { checkLimit, availableAt as computeAvailableAt, remainingQuota } from './limits.js';
import { nextReset, resolveWindow } from './time.js';
import { allow, createPolicy, createRule, deny, evaluate, skip } from './policy.js';

// ============================================================================
// Entitlement Facts
// ============================================================================

/**
 * Standard facts for entitlement evaluation.
 */
interface EntitlementFacts {
	entitlements: Record<string, Entitlement>;
	usage: Record<string, number>;
}

// ============================================================================
// Entitlement Engine
// ============================================================================

/**
 * Options for creating an entitlements engine.
 */
export interface EntitlementsOptions {
	adapter: Adapter;
}

/**
 * Input for check query.
 */
export interface CheckInput {
	actorId: string;
	action: string;
	consume?: number;
}

/**
 * Input for capabilities query.
 */
export interface CapabilitiesInput {
	actorId: string;
	actions: string[];
}

/**
 * Input for availableAt query.
 */
export interface AvailableAtInput {
	actorId: string;
	action: string;
}

/**
 * Input for remainingUses query.
 */
export interface RemainingUsesInput {
	actorId: string;
	action: string;
}

/**
 * Input for dashboard query.
 */
export interface DashboardInput {
	actorId: string;
}

/**
 * Create an entitlements engine with the given adapter.
 */
export function createEntitlements(options: EntitlementsOptions) {
	const { adapter } = options;

	/**
	 * Check if an actor can perform an action.
	 */
	async function check(input: CheckInput): Promise<Decision<{ allowed: boolean }>> {
		const { actorId, action, consume = 1 } = input;

		// Load entitlements
		const entitlements = await adapter.getEntitlements(actorId);

		const entitlement = entitlements[action];
		if (!entitlement) {
			// No entitlement defined for this action - deny by default
			return {
				outcome: { allowed: false },
				reasons: [
					{
						rule: 'entitlement-exists',
						outcome: 'deny',
						explanation: `No entitlement defined for action: ${action}`,
					},
				],
				obligations: [],
				trace: {
					evaluatedAt: new Date(),
					durationMs: 0,
					facts: { entitlements },
				},
			};
		}

		// Load usage if there's a limit
		let used = 0;
		if (entitlement.limit !== null && entitlement.window) {
			const interval = resolveWindow(entitlement.window);
			used = await adapter.getUsage(actorId, action, interval);
		} else if (entitlement.limit !== null) {
			// Lifetime limit - get all-time usage
			const interval = resolveWindow({ type: 'lifetime' });
			used = await adapter.getUsage(actorId, action, interval);
		}

		// Check limit
		const result = checkLimit({
			limit: entitlement.limit,
			used,
			consume,
		});

		const obligations: Obligation[] = result.obligation ? [result.obligation] : [];

		return {
			outcome: { allowed: result.allowed },
			reasons: [
				{
					rule: 'limit-check',
					outcome: result.allowed ? 'allow' : 'deny',
					explanation: result.allowed
						? `Action allowed (${result.remaining === null ? 'unlimited' : `${result.remaining} remaining`})`
						: `Limit exceeded (${used}/${entitlement.limit} used)`,
				},
			],
			obligations,
			trace: {
				evaluatedAt: new Date(),
				durationMs: 0,
				facts: { entitlements, usage: { [action]: used } },
			},
		};
	}

	/**
	 * Get capabilities for multiple actions.
	 */
	async function capabilities(input: CapabilitiesInput): Promise<Capabilities> {
		const { actorId, actions } = input;

		// Load entitlements once
		const entitlements = await adapter.getEntitlements(actorId);

		const result: Record<string, ActionCapability> = {};
		const summary = {
			available: [] as string[],
			exhausted: [] as string[],
			unavailable: [] as string[],
		};

		for (const action of actions) {
			const entitlement = entitlements[action];

			if (!entitlement) {
				result[action] = {
					status: 'unavailable',
					reason: `No entitlement defined for action: ${action}`,
				};
				summary.unavailable.push(action);
				continue;
			}

			// Load usage
			let used = 0;
			let interval = null;
			if (entitlement.limit !== null && entitlement.window) {
				interval = resolveWindow(entitlement.window);
				used = await adapter.getUsage(actorId, action, interval);
			} else if (entitlement.limit !== null) {
				interval = resolveWindow({ type: 'lifetime' });
				used = await adapter.getUsage(actorId, action, interval);
			}

			const remaining = remainingQuota(entitlement.limit, used);
			const resetsAt = entitlement.window ? nextReset(entitlement.window) : null;

			const quotaState: QuotaState = {
				name: action,
				limit: entitlement.limit,
				used,
				remaining,
				window: entitlement.window,
				resetsAt,
				interval,
			};

			// Check if exhausted
			if (entitlement.limit !== null && used >= entitlement.limit) {
				const availability = computeAvailableAt({
					limit: entitlement.limit,
					used,
					window: entitlement.window,
				});

				result[action] = {
					status: 'exhausted',
					reason: `Limit exceeded (${used}/${entitlement.limit} used)`,
					availableAt: availability.status === 'at' ? availability.at : null,
					quota: quotaState,
				};
				summary.exhausted.push(action);
			} else {
				// Check limit to get obligations
				const limitResult = checkLimit({
					limit: entitlement.limit,
					used,
					consume: 1,
				});

				result[action] = {
					status: 'available',
					quota: entitlement.limit === null ? null : quotaState,
					obligations: limitResult.obligation ? [limitResult.obligation] : [],
				};
				summary.available.push(action);
			}
		}

		return { actions: result, summary };
	}

	/**
	 * Get when an action will become available again.
	 */
	async function availableAt(input: AvailableAtInput): Promise<Availability> {
		const { actorId, action } = input;

		// Load entitlements
		const entitlements = await adapter.getEntitlements(actorId);

		const entitlement = entitlements[action];
		if (!entitlement) {
			return {
				status: 'never',
				reason: `No entitlement defined for action: ${action}`,
			};
		}

		// Load usage
		let used = 0;
		if (entitlement.limit !== null && entitlement.window) {
			const interval = resolveWindow(entitlement.window);
			used = await adapter.getUsage(actorId, action, interval);
		} else if (entitlement.limit !== null) {
			const interval = resolveWindow({ type: 'lifetime' });
			used = await adapter.getUsage(actorId, action, interval);
		}

		return computeAvailableAt({
			limit: entitlement.limit,
			used,
			window: entitlement.window,
		});
	}

	/**
	 * Get remaining uses for an action.
	 */
	async function remainingUses(input: RemainingUsesInput): Promise<RemainingUses> {
		const { actorId, action } = input;

		// Load entitlements
		const entitlements = await adapter.getEntitlements(actorId);

		const entitlement = entitlements[action];
		if (!entitlement) {
			return {
				uses: 0,
				limitedBy: 'no-entitlement',
			};
		}

		// Unlimited
		if (entitlement.limit === null) {
			return {
				uses: null,
				limitedBy: null,
			};
		}

		// Load usage
		let used = 0;
		if (entitlement.window) {
			const interval = resolveWindow(entitlement.window);
			used = await adapter.getUsage(actorId, action, interval);
		} else {
			const interval = resolveWindow({ type: 'lifetime' });
			used = await adapter.getUsage(actorId, action, interval);
		}

		return {
			uses: Math.max(0, entitlement.limit - used),
			limitedBy: action,
		};
	}

	/**
	 * Get dashboard showing all quota states for an actor.
	 */
	async function dashboard(input: DashboardInput): Promise<Dashboard> {
		const { actorId } = input;

		// Load entitlements
		const entitlements = await adapter.getEntitlements(actorId);

		const quotas: Record<string, QuotaState> = {};

		for (const [action, entitlement] of Object.entries(entitlements)) {
			// Load usage
			let used = 0;
			let interval = null;
			if (entitlement.limit !== null && entitlement.window) {
				interval = resolveWindow(entitlement.window);
				used = await adapter.getUsage(actorId, action, interval);
			} else if (entitlement.limit !== null) {
				interval = resolveWindow({ type: 'lifetime' });
				used = await adapter.getUsage(actorId, action, interval);
			}

			const remaining = remainingQuota(entitlement.limit, used);
			const resetsAt = entitlement.window ? nextReset(entitlement.window) : null;

			quotas[action] = {
				name: action,
				limit: entitlement.limit,
				used,
				remaining,
				window: entitlement.window,
				resetsAt,
				interval,
			};
		}

		return { quotas };
	}

	return {
		check,
		capabilities,
		availableAt,
		remainingUses,
		dashboard,
	};
}

// ============================================================================
// Export type for the entitlements engine
// ============================================================================

export type EntitlementsEngine = ReturnType<typeof createEntitlements>;
