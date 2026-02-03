/**
 * Core type definitions for the entitlements engine.
 */

import type { Interval } from '@courierkit/core';
export type { Interval };

// ============================================================================
// Time Types
// ============================================================================


/**
 * Calendar unit for time-based windows.
 */
export type CalendarUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * Duration as milliseconds or a structured object.
 */
export type Duration =
	| number
	| {
			hours?: number;
			days?: number;
			weeks?: number;
			months?: number;
	  };

/**
 * Window specification for computing intervals relative to a reference time.
 */
export type WindowSpec =
	| { type: 'calendar'; unit: CalendarUnit; timezone?: string }
	| { type: 'sliding'; duration: Duration }
	| { type: 'lifetime' }
	| { type: 'fixed'; start: Date; end: Date };

// ============================================================================
// Fact Types
// ============================================================================

/**
 * A fact definition for loading data into the engine.
 */
export interface FactDefinition<T = unknown> {
	name: string;
	depends?: string[];
	load: (input: Record<string, unknown>, facts: Record<string, unknown>) => T | Promise<T>;
}

// ============================================================================
// Rule Types
// ============================================================================

/**
 * An obligation is a declarative instruction attached to an allow result.
 * The engine does not execute obligations; they are returned to the caller.
 */
export interface Obligation {
	type: string;
	params: Record<string, unknown>;
}

/**
 * Result of evaluating a single rule.
 */
export type RuleResult =
	| { outcome: 'allow'; explanation: string; obligations?: Obligation[] }
	| { outcome: 'deny'; explanation: string }
	| { outcome: 'skip'; explanation: string };

/**
 * A rule is a pure predicate that examines facts and returns a result.
 */
export interface Rule<TFacts = Record<string, unknown>, TInput = Record<string, unknown>> {
	id: string;
	description: string;
	evaluate: (facts: TFacts, input: TInput) => RuleResult | Promise<RuleResult>;
}

// ============================================================================
// Decision Types
// ============================================================================

/**
 * Captures what happened for a single rule evaluation.
 */
export interface Reason {
	rule: string;
	outcome: 'allow' | 'deny' | 'skip';
	explanation: string;
	metadata?: Record<string, unknown>;
}

/**
 * Trace information for debugging and audit.
 */
export interface Trace {
	evaluatedAt: Date;
	durationMs: number;
	facts: Record<string, unknown>;
}

/**
 * The resolved output of policy evaluation.
 */
export interface Decision<T = unknown> {
	outcome: T;
	reasons: Reason[];
	obligations: Obligation[];
	trace: Trace;
}

// ============================================================================
// Policy Types
// ============================================================================

/**
 * A policy combines facts, rules, and a resolution strategy.
 */
export interface Policy<
	TOutcome = unknown,
	TFacts = Record<string, unknown>,
	TInput = Record<string, unknown>,
> {
	facts: Record<string, FactDefinition>;
	rules: Rule<TFacts, TInput>[];
	resolve: (results: RuleResult[], input: TInput, facts: TFacts) => TOutcome;
}

// ============================================================================
// Entitlement Types
// ============================================================================

/**
 * The minimal entitlement information needed to check a limit.
 */
export interface Entitlement {
	limit: number | null; // null = unlimited
	window: WindowSpec | null; // null = no time-based reset (lifetime or unlimited)
}

/**
 * Usage data for a resource.
 */
export interface Usage {
	count: number;
	interval: Interval | null;
}

/**
 * Result of checking a limit.
 */
export interface LimitCheckResult {
	allowed: boolean;
	remaining: number | null; // null = unlimited
	obligation?: Obligation;
}

/**
 * Availability status.
 */
export type Availability =
	| { status: 'now' }
	| { status: 'at'; at: Date; reason: string }
	| { status: 'never'; reason: string }
	| { status: 'unknown'; reason: string };

/**
 * A unified view of a quota for display or debugging.
 */
export interface QuotaState {
	name: string;
	limit: number | null;
	used: number;
	remaining: number | null;
	window: WindowSpec | null;
	resetsAt: Date | null;
	interval: Interval | null;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Input for policy evaluation.
 */
export type EvaluateInput = Record<string, unknown>;

/**
 * Capability status for a single action.
 */
export type ActionCapability =
	| {
			status: 'available';
			quota: QuotaState | null;
			obligations: Obligation[];
	  }
	| {
			status: 'exhausted';
			reason: string;
			availableAt: Date | null;
			quota: QuotaState;
	  }
	| {
			status: 'unavailable';
			reason: string;
	  };

/**
 * Capabilities across multiple actions.
 */
export interface Capabilities {
	actions: Record<string, ActionCapability>;
	summary: {
		available: string[];
		exhausted: string[];
		unavailable: string[];
	};
}

/**
 * Remaining uses result.
 */
export interface RemainingUses {
	uses: number | null; // null = unlimited
	limitedBy: string | null;
}

/**
 * Dashboard showing all quota states for an actor.
 */
export interface Dashboard {
	quotas: Record<string, QuotaState>;
}

// ============================================================================
// Adapter Types
// ============================================================================

/**
 * Adapter interface for mapping consumer data to standard shapes.
 */
export interface Adapter {
	getEntitlements: (actorId: string) => Promise<Record<string, Entitlement>>;
	getUsage: (actorId: string, action: string, interval: Interval) => Promise<number>;
}
