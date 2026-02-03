/**
 * Time primitives for working with intervals and window specifications.
 */

import {
	addDays,
	addHours,
	addMonths,
	addWeeks,
	addYears,
	endOfDay,
	endOfHour,
	endOfMonth,
	endOfWeek,
	endOfYear,
	startOfDay,
	startOfHour,
	startOfMonth,
	startOfWeek,
	startOfYear,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { CalendarUnit, Duration, Interval, WindowSpec } from './types.js';

// ============================================================================
// Duration Helpers
// ============================================================================

/**
 * Convert a Duration to milliseconds.
 */
export function durationToMs(duration: Duration): number {
	if (typeof duration === 'number') {
		return duration;
	}

	let ms = 0;
	if (duration.hours) ms += duration.hours * 60 * 60 * 1000;
	if (duration.days) ms += duration.days * 24 * 60 * 60 * 1000;
	if (duration.weeks) ms += duration.weeks * 7 * 24 * 60 * 60 * 1000;
	// For months, approximate as 30 days
	if (duration.months) ms += duration.months * 30 * 24 * 60 * 60 * 1000;

	return ms;
}

// ============================================================================
// Calendar Window Helpers
// ============================================================================

function getStartOfUnit(date: Date, unit: CalendarUnit, timezone?: string): Date {
	// If timezone is specified, convert to that zone, get start of unit, convert back to UTC
	const workingDate = timezone ? toZonedTime(date, timezone) : date;

	let result: Date;
	switch (unit) {
		case 'hour':
			result = startOfHour(workingDate);
			break;
		case 'day':
			result = startOfDay(workingDate);
			break;
		case 'week':
			result = startOfWeek(workingDate, { weekStartsOn: 1 }); // Monday start
			break;
		case 'month':
			result = startOfMonth(workingDate);
			break;
		case 'year':
			result = startOfYear(workingDate);
			break;
	}

	return timezone ? fromZonedTime(result, timezone) : result;
}

function getEndOfUnit(date: Date, unit: CalendarUnit, timezone?: string): Date {
	const workingDate = timezone ? toZonedTime(date, timezone) : date;

	let result: Date;
	switch (unit) {
		case 'hour':
			result = new Date(endOfHour(workingDate).getTime() + 1);
			break;
		case 'day':
			result = new Date(endOfDay(workingDate).getTime() + 1);
			break;
		case 'week':
			result = new Date(endOfWeek(workingDate, { weekStartsOn: 1 }).getTime() + 1);
			break;
		case 'month':
			result = new Date(endOfMonth(workingDate).getTime() + 1);
			break;
		case 'year':
			result = new Date(endOfYear(workingDate).getTime() + 1);
			break;
	}

	return timezone ? fromZonedTime(result, timezone) : result;
}

function addUnit(date: Date, unit: CalendarUnit, amount: number): Date {
	switch (unit) {
		case 'hour':
			return addHours(date, amount);
		case 'day':
			return addDays(date, amount);
		case 'week':
			return addWeeks(date, amount);
		case 'month':
			return addMonths(date, amount);
		case 'year':
			return addYears(date, amount);
	}
}

// ============================================================================
// Window Operations
// ============================================================================

/** Far future date used for lifetime windows */
const FAR_FUTURE = new Date('9999-12-31T23:59:59.999Z');

/** Epoch date used for lifetime windows */
const EPOCH = new Date(0);

/**
 * Given a window spec and a reference time, returns the concrete interval.
 *
 * @param spec - The window specification
 * @param at - Reference time (defaults to now)
 * @returns The concrete interval [start, end)
 */
export function resolveWindow(spec: WindowSpec, at: Date = new Date()): Interval {
	switch (spec.type) {
		case 'calendar': {
			const start = getStartOfUnit(at, spec.unit, spec.timezone);
			const end = getEndOfUnit(at, spec.unit, spec.timezone);
			return { start, end };
		}

		case 'sliding': {
			const ms = durationToMs(spec.duration);
			const start = new Date(at.getTime() - ms);
			return { start, end: at };
		}

		case 'lifetime': {
			return { start: EPOCH, end: FAR_FUTURE };
		}

		case 'fixed': {
			return { start: spec.start, end: spec.end };
		}
	}
}

/**
 * Returns when the window next resets, or null for lifetime windows.
 *
 * @param spec - The window specification
 * @param at - Reference time (defaults to now)
 * @returns The next reset time, or null for lifetime/fixed windows
 */
export function nextReset(spec: WindowSpec, at: Date = new Date()): Date | null {
	switch (spec.type) {
		case 'calendar': {
			const start = getStartOfUnit(at, spec.unit, spec.timezone);
			return addUnit(start, spec.unit, 1);
		}

		case 'sliding': {
			// Sliding windows continuously reset; return when the earliest
			// item in the window would fall out
			const ms = durationToMs(spec.duration);
			return new Date(at.getTime() + ms);
		}

		case 'lifetime':
		case 'fixed':
			return null;
	}
}

/**
 * Human-readable description of a window spec.
 *
 * @param spec - The window specification
 * @returns A human-readable description
 */
export function describeWindow(spec: WindowSpec): string {
	switch (spec.type) {
		case 'calendar':
			switch (spec.unit) {
				case 'hour':
					return 'resets hourly';
				case 'day':
					return 'resets daily';
				case 'week':
					return 'resets weekly';
				case 'month':
					return 'resets monthly';
				case 'year':
					return 'resets yearly';
			}
			break;

		case 'sliding': {
			const duration = spec.duration;
			if (typeof duration === 'number') {
				const hours = duration / (1000 * 60 * 60);
				return `${hours}-hour rolling window`;
			}
			const parts: string[] = [];
			if (duration.months) parts.push(`${duration.months} month${duration.months > 1 ? 's' : ''}`);
			if (duration.weeks) parts.push(`${duration.weeks} week${duration.weeks > 1 ? 's' : ''}`);
			if (duration.days) parts.push(`${duration.days} day${duration.days > 1 ? 's' : ''}`);
			if (duration.hours) parts.push(`${duration.hours} hour${duration.hours > 1 ? 's' : ''}`);
			return `${parts.join(', ')} rolling window`;
		}

		case 'lifetime':
			return 'lifetime';

		case 'fixed':
			return 'fixed window';
	}
}

// ============================================================================
// Window Presets
// ============================================================================

/**
 * Convenience constants for common windows.
 */
export const windows = {
	hourly: { type: 'calendar', unit: 'hour' } as WindowSpec,
	daily: { type: 'calendar', unit: 'day' } as WindowSpec,
	weekly: { type: 'calendar', unit: 'week' } as WindowSpec,
	monthly: { type: 'calendar', unit: 'month' } as WindowSpec,
	yearly: { type: 'calendar', unit: 'year' } as WindowSpec,
	lifetime: { type: 'lifetime' } as WindowSpec,

	/**
	 * Create a rolling window spec.
	 */
	rolling(amount: number, unit: 'hours' | 'days' | 'weeks'): WindowSpec {
		return { type: 'sliding', duration: { [unit]: amount } };
	},
};

// ============================================================================
// Interval Helpers
// ============================================================================

/**
 * Check if an interval contains a point in time.
 */
export function intervalContains(interval: Interval, time: Date): boolean {
	return time >= interval.start && time < interval.end;
}

/**
 * Check if two intervals overlap.
 */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
	return a.start < b.end && b.start < a.end;
}

/**
 * Get the duration of an interval in milliseconds.
 */
export function intervalDuration(interval: Interval): number {
	return interval.end.getTime() - interval.start.getTime();
}
