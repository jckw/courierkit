/**
 * Schedule expansion functions for converting schedule rules to UTC intervals.
 */

import { mergeIntervals, subtractIntervals } from './intervals.js';
import type {
	DateRange,
	DayOfWeek,
	Interval,
	LocalTime,
	Schedule,
	ScheduleOverride,
	ScheduleRule,
} from './types.js';

/**
 * Maps JavaScript's getDay() (0=Sunday) to our DayOfWeek type.
 */
const _DAY_INDEX_TO_NAME: DayOfWeek[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
];

/**
 * Converts a date (which may be Date or YYYY-MM-DD string) to a Date object at midnight UTC.
 */
function normalizeDate(date: Date | string): Date {
	if (date instanceof Date) {
		return date;
	}
	// Parse YYYY-MM-DD string as UTC midnight
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Gets the YYYY-MM-DD string representation of a date in a specific timezone.
 */
function getDateStringInTimezone(date: Date, timezone: string): string {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	return formatter.format(date);
}

/**
 * Gets the day of week for a date in a specific timezone.
 */
function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		weekday: 'long',
	});
	const dayName = formatter.format(date).toLowerCase() as DayOfWeek;
	return dayName;
}

/**
 * Converts a local date + time + timezone to a UTC Date.
 *
 * This handles DST transitions correctly by using Intl.DateTimeFormat
 * to determine the actual UTC offset at that specific local time.
 *
 * @param date - The date (only year/month/day are used)
 * @param time - Local time string in HH:MM format
 * @param timezone - IANA timezone identifier
 * @returns UTC Date object
 */
function localTimeToUTC(date: Date, time: LocalTime, timezone: string): Date {
	// Get the date string in the target timezone
	const dateStr = getDateStringInTimezone(date, timezone);
	const [year, month, day] = dateStr.split('-').map(Number);
	const [hours, minutes] = time.split(':').map(Number);

	// Create a date string that represents the local time
	// We'll use a binary search approach to find the correct UTC time
	// that corresponds to this local time in the given timezone

	// Start with a rough estimate: create UTC date with local time values
	// This treats the local time as if it were UTC
	const roughEstimate = new Date(Date.UTC(year, month - 1, day, hours, minutes));

	// Get the offset at this rough time by formatting and comparing
	// Offset is positive when local time is ahead of UTC
	const offsetMs = getTimezoneOffset(roughEstimate, timezone);

	// To convert local time to UTC, we subtract the offset
	// (if local is behind UTC like EST=-5, offset is negative, so we add 5 hours)
	const utcTime = new Date(roughEstimate.getTime() - offsetMs);

	// Verify and adjust if needed (handles edge cases around DST transitions)
	const verifyOffset = getTimezoneOffset(utcTime, timezone);
	if (verifyOffset !== offsetMs) {
		// DST transition edge case - recalculate with the new offset
		return new Date(roughEstimate.getTime() - verifyOffset);
	}

	return utcTime;
}

/**
 * Gets the timezone offset in milliseconds for a given UTC time.
 * Positive offset means the local time is behind UTC.
 *
 * @param utcDate - A UTC Date object
 * @param timezone - IANA timezone identifier
 * @returns Offset in milliseconds to add to local time to get UTC
 */
function getTimezoneOffset(utcDate: Date, timezone: string): number {
	// Format the UTC date in the target timezone
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});

	const parts = formatter.formatToParts(utcDate);
	const getPart = (type: string): number => {
		const part = parts.find((p) => p.type === type);
		return part ? parseInt(part.value, 10) : 0;
	};

	const localYear = getPart('year');
	const localMonth = getPart('month');
	const localDay = getPart('day');
	const localHour = getPart('hour');
	const localMinute = getPart('minute');
	const localSecond = getPart('second');

	// Create a UTC date with the local time components
	const localAsUTC = new Date(
		Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, localSecond),
	);

	// The difference is the offset
	return localAsUTC.getTime() - utcDate.getTime();
}

/**
 * Checks if a rule is effective on a given date.
 */
function isRuleEffective(rule: ScheduleRule, date: Date): boolean {
	if (rule.effectiveFrom) {
		const effectiveFrom = normalizeDate(rule.effectiveFrom);
		// Get the date in the rule's timezone for comparison
		const dateStr = getDateStringInTimezone(date, rule.timezone);
		const fromStr = getDateStringInTimezone(effectiveFrom, rule.timezone);
		if (dateStr < fromStr) {
			return false;
		}
	}

	if (rule.effectiveUntil) {
		const effectiveUntil = normalizeDate(rule.effectiveUntil);
		const dateStr = getDateStringInTimezone(date, rule.timezone);
		const untilStr = getDateStringInTimezone(effectiveUntil, rule.timezone);
		// effectiveUntil is exclusive - the rule expires on this date
		if (dateStr >= untilStr) {
			return false;
		}
	}

	return true;
}

/**
 * Checks if an override applies to a given date (comparing in the schedule's timezone).
 */
function doesOverrideApply(override: ScheduleOverride, date: Date, timezone: string): boolean {
	const overrideDate = normalizeDate(override.date);
	const overrideDateStr = getDateStringInTimezone(overrideDate, timezone);
	const currentDateStr = getDateStringInTimezone(date, timezone);
	return overrideDateStr === currentDateStr;
}

/**
 * Generates an interval from a schedule rule for a specific date.
 */
function generateIntervalFromRule(rule: ScheduleRule, date: Date): Interval {
	const startUTC = localTimeToUTC(date, rule.startTime, rule.timezone);
	const endUTC = localTimeToUTC(date, rule.endTime, rule.timezone);

	return { start: startUTC, end: endUTC };
}

/**
 * Iterates through each day in a date range.
 * Yields Date objects at midnight UTC for each day.
 */
function* iterateDays(range: DateRange): Generator<Date> {
	const current = new Date(range.start.getTime());
	// Normalize to midnight UTC
	current.setUTCHours(0, 0, 0, 0);

	const end = new Date(range.end.getTime());

	while (current < end) {
		yield new Date(current.getTime());
		current.setUTCDate(current.getUTCDate() + 1);
	}
}

/**
 * Expands a schedule into UTC intervals for a given date range.
 *
 * This function:
 * 1. Iterates through each day in the range
 * 2. For each day, finds applicable rules (matching day of week, within effective dates)
 * 3. Converts local times to UTC
 * 4. Applies overrides (removing or adding availability)
 * 5. Returns merged, sorted intervals in UTC
 *
 * @param schedule - The schedule containing rules and overrides
 * @param range - The date range to expand
 * @returns Array of UTC intervals representing availability
 *
 * @example
 * ```typescript
 * const schedule: Schedule = {
 *   id: 'default',
 *   rules: [{
 *     days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
 *     startTime: '09:00',
 *     endTime: '17:00',
 *     timezone: 'America/New_York'
 *   }],
 *   overrides: [{
 *     date: '2024-12-25',
 *     available: false
 *   }]
 * };
 *
 * const intervals = expandSchedule(schedule, {
 *   start: new Date('2024-12-23T00:00:00Z'),
 *   end: new Date('2024-12-28T00:00:00Z')
 * });
 * ```
 */
export function expandSchedule(schedule: Schedule, range: DateRange): Interval[] {
	const intervals: Interval[] = [];
	const overridesToRemove: Interval[] = [];
	const overridesToAdd: Interval[] = [];

	// Get a representative timezone from the rules (for override date comparison)
	// Default to UTC if no rules exist
	const defaultTimezone = schedule.rules.length > 0 ? schedule.rules[0].timezone : 'UTC';

	// Process each day in the range
	for (const day of iterateDays(range)) {
		// Find all applicable rules for this day
		for (const rule of schedule.rules) {
			// Check if the day of week matches (in the rule's timezone)
			const dayOfWeek = getDayOfWeekInTimezone(day, rule.timezone);

			if (!rule.days.includes(dayOfWeek)) {
				continue;
			}

			// Check if the rule is effective on this date
			if (!isRuleEffective(rule, day)) {
				continue;
			}

			// Generate the interval for this rule on this day
			const interval = generateIntervalFromRule(rule, day);

			// Only add if the interval is valid (start < end)
			if (interval.start < interval.end) {
				intervals.push(interval);
			}
		}

		// Process overrides for this day
		if (schedule.overrides) {
			for (const override of schedule.overrides) {
				if (!doesOverrideApply(override, day, defaultTimezone)) {
					continue;
				}

				if (override.available === false) {
					// Remove availability for this day
					if (override.startTime && override.endTime) {
						// Remove specific time window
						const removeStart = localTimeToUTC(day, override.startTime, defaultTimezone);
						const removeEnd = localTimeToUTC(day, override.endTime, defaultTimezone);
						overridesToRemove.push({ start: removeStart, end: removeEnd });
					} else {
						// Remove entire day - use a wide window
						const dayStart = new Date(day.getTime());
						dayStart.setUTCHours(0, 0, 0, 0);
						const dayEnd = new Date(day.getTime());
						dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
						dayEnd.setUTCHours(0, 0, 0, 0);
						overridesToRemove.push({ start: dayStart, end: dayEnd });
					}
				} else {
					// Add availability
					if (override.startTime && override.endTime) {
						const addStart = localTimeToUTC(day, override.startTime, defaultTimezone);
						const addEnd = localTimeToUTC(day, override.endTime, defaultTimezone);
						if (addStart < addEnd) {
							overridesToAdd.push({ start: addStart, end: addEnd });
						}
					}
					// If no times specified for available: true, it's a no-op
					// (the existing rules already provide availability)
				}
			}
		}
	}

	// First merge all rule-based intervals
	let result = mergeIntervals(intervals);

	// Apply removal overrides
	if (overridesToRemove.length > 0) {
		result = subtractIntervals(result, overridesToRemove);
	}

	// Add override intervals
	if (overridesToAdd.length > 0) {
		result = mergeIntervals([...result, ...overridesToAdd]);
	}

	// Clip to the requested range
	result = result
		.map((interval) => ({
			start: new Date(Math.max(interval.start.getTime(), range.start.getTime())),
			end: new Date(Math.min(interval.end.getTime(), range.end.getTime())),
		}))
		.filter((interval) => interval.start < interval.end);

	return result;
}
