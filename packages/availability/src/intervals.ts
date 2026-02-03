/**
 * Interval arithmetic functions for working with time intervals.
 * All intervals are half-open [start, end), meaning start is inclusive and end is exclusive.
 */

import type { Interval } from './types.js';

export type { Interval };

/**
 * Creates a copy of an interval with new Date objects.
 */
function cloneInterval(interval: Interval): Interval {
	return {
		start: new Date(interval.start.getTime()),
		end: new Date(interval.end.getTime()),
	};
}

/**
 * Checks if two intervals overlap or are adjacent.
 * Since intervals are half-open [start, end), intervals that share only
 * an endpoint (e.g., [a, b) and [b, c)) are considered adjacent and can be merged.
 */
function _intervalsOverlapOrAdjacent(a: Interval, b: Interval): boolean {
	return a.start <= b.end && b.start <= a.end;
}

/**
 * Checks if two intervals strictly overlap (share some time, not just an endpoint).
 * For half-open intervals [start, end), sharing only an endpoint means no overlap.
 */
function intervalsOverlap(a: Interval, b: Interval): boolean {
	return a.start < b.end && b.start < a.end;
}

/**
 * Merges overlapping or adjacent intervals into a sorted list of non-overlapping intervals.
 *
 * @param intervals - Array of intervals to merge (can be unsorted)
 * @returns A sorted array of non-overlapping intervals covering the same total time
 *
 * @example
 * ```typescript
 * const intervals = [
 *   { start: new Date('2024-01-01T10:00:00'), end: new Date('2024-01-01T12:00:00') },
 *   { start: new Date('2024-01-01T11:00:00'), end: new Date('2024-01-01T13:00:00') },
 * ];
 * const merged = mergeIntervals(intervals);
 * // Result: [{ start: 2024-01-01T10:00:00, end: 2024-01-01T13:00:00 }]
 * ```
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
	// Handle empty input
	if (intervals.length === 0) {
		return [];
	}

	// Filter out invalid intervals (where start >= end) and clone to avoid mutating input
	const validIntervals = intervals
		.filter((interval) => interval.start < interval.end)
		.map(cloneInterval);

	if (validIntervals.length === 0) {
		return [];
	}

	// Sort by start time, then by end time for consistent results
	validIntervals.sort((a, b) => {
		const startDiff = a.start.getTime() - b.start.getTime();
		if (startDiff !== 0) return startDiff;
		return a.end.getTime() - b.end.getTime();
	});

	const merged: Interval[] = [cloneInterval(validIntervals[0])];

	for (let i = 1; i < validIntervals.length; i++) {
		const current = validIntervals[i];
		const lastMerged = merged[merged.length - 1];

		// Check if current interval overlaps or is adjacent to the last merged interval
		// For half-open intervals, [a, b) and [b, c) are adjacent and should merge
		if (current.start <= lastMerged.end) {
			// Extend the last merged interval if necessary
			if (current.end > lastMerged.end) {
				lastMerged.end = new Date(current.end.getTime());
			}
		} else {
			// No overlap, add as a new interval
			merged.push(cloneInterval(current));
		}
	}

	return merged;
}

/**
 * Subtracts a set of intervals from another set of intervals.
 * Removes all time covered by 'subtract' from 'from' intervals.
 * May split intervals if subtraction punches holes in the middle.
 *
 * @param from - The intervals to subtract from
 * @param subtract - The intervals to subtract
 * @returns The remaining intervals after subtraction
 *
 * @example
 * ```typescript
 * const from = [
 *   { start: new Date('2024-01-01T08:00:00'), end: new Date('2024-01-01T17:00:00') },
 * ];
 * const subtract = [
 *   { start: new Date('2024-01-01T12:00:00'), end: new Date('2024-01-01T13:00:00') },
 * ];
 * const result = subtractIntervals(from, subtract);
 * // Result: [
 * //   { start: 2024-01-01T08:00:00, end: 2024-01-01T12:00:00 },
 * //   { start: 2024-01-01T13:00:00, end: 2024-01-01T17:00:00 }
 * // ]
 * ```
 */
export function subtractIntervals(from: Interval[], subtract: Interval[]): Interval[] {
	// Handle empty input cases
	if (from.length === 0) {
		return [];
	}

	if (subtract.length === 0) {
		return mergeIntervals(from);
	}

	// First, merge both sets to simplify the operation
	const mergedFrom = mergeIntervals(from);
	const mergedSubtract = mergeIntervals(subtract);

	const result: Interval[] = [];

	for (const interval of mergedFrom) {
		let remaining: Interval[] = [cloneInterval(interval)];

		for (const sub of mergedSubtract) {
			const newRemaining: Interval[] = [];

			for (const rem of remaining) {
				// Check if there's any overlap
				if (!intervalsOverlap(rem, sub)) {
					// No overlap, keep the interval as is
					newRemaining.push(rem);
					continue;
				}

				// There is overlap, we need to subtract
				// Part before the subtraction interval
				if (rem.start < sub.start) {
					newRemaining.push({
						start: new Date(rem.start.getTime()),
						end: new Date(sub.start.getTime()),
					});
				}

				// Part after the subtraction interval
				if (rem.end > sub.end) {
					newRemaining.push({
						start: new Date(sub.end.getTime()),
						end: new Date(rem.end.getTime()),
					});
				}
			}

			remaining = newRemaining;
		}

		result.push(...remaining);
	}

	// Sort the result by start time
	result.sort((a, b) => a.start.getTime() - b.start.getTime());

	return result;
}

/**
 * Computes the intersection of two sets of intervals.
 * Returns only the time that appears in both input sets.
 *
 * @param a - First set of intervals
 * @param b - Second set of intervals
 * @returns Intervals representing time present in both a and b
 *
 * @example
 * ```typescript
 * const a = [
 *   { start: new Date('2024-01-01T08:00:00'), end: new Date('2024-01-01T12:00:00') },
 * ];
 * const b = [
 *   { start: new Date('2024-01-01T10:00:00'), end: new Date('2024-01-01T14:00:00') },
 * ];
 * const result = intersectIntervals(a, b);
 * // Result: [{ start: 2024-01-01T10:00:00, end: 2024-01-01T12:00:00 }]
 * ```
 */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
	// Handle empty input cases
	if (a.length === 0 || b.length === 0) {
		return [];
	}

	// Merge both sets first to simplify
	const mergedA = mergeIntervals(a);
	const mergedB = mergeIntervals(b);

	const result: Interval[] = [];

	let i = 0;
	let j = 0;

	// Use a two-pointer approach on sorted, merged intervals
	while (i < mergedA.length && j < mergedB.length) {
		const intervalA = mergedA[i];
		const intervalB = mergedB[j];

		// Calculate the intersection
		const start = new Date(Math.max(intervalA.start.getTime(), intervalB.start.getTime()));
		const end = new Date(Math.min(intervalA.end.getTime(), intervalB.end.getTime()));

		// If valid intersection (start < end for half-open intervals)
		if (start < end) {
			result.push({ start, end });
		}

		// Move the pointer for the interval that ends first
		if (intervalA.end <= intervalB.end) {
			i++;
		} else {
			j++;
		}
	}

	return result;
}
