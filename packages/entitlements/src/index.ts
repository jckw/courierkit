/**
 * @courierkit/entitlements
 *
 * A stateless, composable policy decision library for TypeScript.
 * Given facts about actors, resources, and constraints, it answers the question:
 * "Is this allowed, and why?"
 */

// ============================================================================
// Types
// ============================================================================

export type {
	// Time types
	Interval,
	CalendarUnit,
	Duration,
	WindowSpec,
	// Fact types
	FactDefinition,
	// Rule types
	Obligation,
	RuleResult,
	Rule,
	// Decision types
	Reason,
	Trace,
	Decision,
	// Policy types
	Policy,
	// Entitlement types
	Entitlement,
	Usage,
	LimitCheckResult,
	Availability,
	QuotaState,
	// Query types
	EvaluateInput,
	ActionCapability,
	Capabilities,
	RemainingUses,
	Dashboard,
	// Adapter types
	Adapter,
} from './types.js';

// ============================================================================
// Time Primitives
// ============================================================================

export {
	// Duration helpers
	durationToMs,
	// Window operations
	resolveWindow,
	nextReset,
	describeWindow,
	// Window presets
	windows,
	// Interval helpers
	intervalContains,
	intervalsOverlap,
	intervalDuration,
} from './time.js';

// ============================================================================
// Limit Checking
// ============================================================================

export { checkLimit, availableAt, remainingQuota } from './limits.js';

// ============================================================================
// Policy Engine
// ============================================================================

export {
	// Evaluation
	evaluate,
	// Resolution strategies
	resolveAllMustAllow,
	resolveAnyMustAllow,
	createWeightedResolver,
	// Builders
	createPolicy,
	createRule,
	// Result helpers
	allow,
	deny,
	skip,
} from './policy.js';

// ============================================================================
// Entitlements Engine
// ============================================================================

export {
	createEntitlements,
	type EntitlementsEngine,
	type EntitlementsOptions,
	type CheckInput,
	type CapabilitiesInput,
	type AvailableAtInput,
	type RemainingUsesInput,
	type DashboardInput,
} from './entitlements.js';
