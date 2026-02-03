/**
 * CourierKit Core
 *
 * Shared time primitives for CourierKit packages.
 * All intervals are half-open: [start, end)
 */

/**
 * A half-open interval [start, end).
 * All times are UTC internally.
 */
export interface Interval {
	start: Date;
	end: Date;
}

/**
 * A date range for querying time-bounded data.
 * Semantically identical to Interval.
 */
export interface DateRange {
	start: Date;
	end: Date;
}

/**
 * Duration in milliseconds.
 */
export type DurationMs = number;
