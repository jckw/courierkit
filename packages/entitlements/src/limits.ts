/**
 * Limit checking helpers for quota evaluation.
 */

import type { Availability, LimitCheckResult, Obligation, WindowSpec } from './types.js';
import { nextReset } from './time.js';

/**
 * Check if an action is allowed given a limit and current usage.
 *
 * @param input.limit - The configured limit (null = unlimited)
 * @param input.used - Current usage count
 * @param input.consume - Amount to consume (default 1)
 * @returns Whether the action is allowed and the remaining quota
 */
export function checkLimit(input: {
	limit: number | null;
	used: number;
	consume?: number;
}): LimitCheckResult {
	const { limit, used, consume = 1 } = input;

	// Unlimited
	if (limit === null) {
		return {
			allowed: true,
			remaining: null,
		};
	}

	const remaining = limit - used;
	const wouldExceed = used + consume > limit;

	if (wouldExceed) {
		return {
			allowed: false,
			remaining: Math.max(0, remaining),
		};
	}

	// Create consume obligation
	const obligation: Obligation = {
		type: 'consume',
		params: { amount: consume },
	};

	return {
		allowed: true,
		remaining: remaining - consume,
		obligation,
	};
}

/**
 * Determine when an action will become available again.
 *
 * @param input.limit - The configured limit (null = unlimited)
 * @param input.used - Current usage count
 * @param input.window - The window spec for quota reset
 * @param input.at - Reference time (defaults to now)
 * @returns Availability status
 */
export function availableAt(input: {
	limit: number | null;
	used: number;
	window: WindowSpec | null;
	at?: Date;
}): Availability {
	const { limit, used, window, at = new Date() } = input;

	// Unlimited
	if (limit === null) {
		return { status: 'now' };
	}

	// Within limit
	if (used < limit) {
		return { status: 'now' };
	}

	// At or over limit - check when it resets
	if (window === null) {
		// No window means lifetime limit
		return {
			status: 'never',
			reason: 'Lifetime limit reached',
		};
	}

	if (window.type === 'lifetime') {
		return {
			status: 'never',
			reason: 'Lifetime limit reached',
		};
	}

	if (window.type === 'fixed') {
		return {
			status: 'never',
			reason: 'Fixed window limit reached',
		};
	}

	const resetTime = nextReset(window, at);
	if (resetTime === null) {
		return {
			status: 'unknown',
			reason: 'Cannot determine reset time',
		};
	}

	return {
		status: 'at',
		at: resetTime,
		reason: `Limit resets at ${resetTime.toISOString()}`,
	};
}

/**
 * Calculate the remaining quota.
 *
 * @param limit - The configured limit (null = unlimited)
 * @param used - Current usage count
 * @returns Remaining uses (null = unlimited)
 */
export function remainingQuota(limit: number | null, used: number): number | null {
	if (limit === null) {
		return null;
	}
	return Math.max(0, limit - used);
}
