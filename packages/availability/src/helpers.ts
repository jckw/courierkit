/**
 * Helper functions for the Slot Engine.
 */

import type {
	Block,
	DateRange,
	DayOfWeek,
	FreeBusyResponse,
	HostId,
	Interval,
	RecurrenceRule,
} from './types.js';

/**
 * Maps DayOfWeek to JavaScript's getDay() values (0 = Sunday, 6 = Saturday)
 */
const _DAY_TO_NUMBER: Record<DayOfWeek, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

/**
 * Maps JavaScript's getDay() values to DayOfWeek
 */
const _NUMBER_TO_DAY: DayOfWeek[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
];

/**
 * Converts a local time (HH:MM) on a specific date in a timezone to UTC.
 *
 * @param date - The date (used to get year, month, day in local time)
 * @param localTime - Time in HH:MM format
 * @param timezone - IANA timezone identifier
 * @returns Date object in UTC
 */
function localTimeToUtc(date: Date, localTime: string, timezone: string): Date {
	const [hours, minutes] = localTime.split(':').map(Number);

	// Get the date components in the target timezone
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	const dateParts = formatter.format(date);
	const [year, month, day] = dateParts.split('-').map(Number);

	// Create ISO string for the local datetime
	const localIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

	// Calculate the UTC offset for this timezone at this time
	// Create a date in UTC and format it in the target timezone to find the offset
	const tempDate = new Date(`${localIso}Z`);
	const utcFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hour12: false,
	});

	const parts = utcFormatter.formatToParts(tempDate);
	const getPart = (type: string): number => {
		const part = parts.find((p) => p.type === type);
		return part ? parseInt(part.value, 10) : 0;
	};

	const tzYear = getPart('year');
	const tzMonth = getPart('month');
	const tzDay = getPart('day');
	const tzHour = getPart('hour') === 24 ? 0 : getPart('hour');
	const tzMinute = getPart('minute');

	// Calculate the offset in milliseconds
	const tzDate = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
	const offset = tzDate - tempDate.getTime();

	// Now create the actual local time and subtract the offset to get UTC
	const localTimestamp = Date.UTC(year, month - 1, day, hours, minutes, 0);
	return new Date(localTimestamp - offset);
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
 * Gets the day of month for a date in a specific timezone.
 */
function getDayOfMonthInTimezone(date: Date, timezone: string): number {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		day: 'numeric',
	});
	return parseInt(formatter.format(date), 10);
}

/**
 * Gets the start of a day in a specific timezone as a UTC Date.
 */
function _getStartOfDayInTimezone(date: Date, timezone: string): Date {
	return localTimeToUtc(date, '00:00', timezone);
}

/**
 * Adds days to a date.
 */
function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

/**
 * Checks if a date matches any date in the exclude list (comparing by date only in timezone).
 */
function isExcluded(date: Date, excludeDates: Date[] | undefined, timezone: string): boolean {
	if (!excludeDates || excludeDates.length === 0) {
		return false;
	}

	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});

	const dateStr = formatter.format(date);

	return excludeDates.some((excludeDate) => {
		const excludeStr = formatter.format(excludeDate);
		return dateStr === excludeStr;
	});
}

/**
 * Gets the ISO week number for a date.
 */
function getWeekNumber(date: Date): number {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	// Set to nearest Thursday: current date + 4 - current day number (Mon = 1, Sun = 7)
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Checks if a date is in the same biweekly cycle as the anchor date.
 */
function isInBiweeklyCycle(date: Date, anchorDate: Date): boolean {
	const anchorWeek = getWeekNumber(anchorDate);
	const dateWeek = getWeekNumber(date);

	// Calculate year difference to handle year boundaries
	const anchorYear = anchorDate.getUTCFullYear();
	const dateYear = date.getUTCFullYear();

	// Total weeks from a reference point
	const anchorTotalWeeks = anchorYear * 52 + anchorWeek;
	const dateTotalWeeks = dateYear * 52 + dateWeek;

	// Check if the difference is even (same biweekly cycle)
	return (dateTotalWeeks - anchorTotalWeeks) % 2 === 0;
}

/**
 * Expands a recurrence rule into concrete intervals within the date range.
 *
 * @param rule - The recurrence rule to expand
 * @param range - The date range to expand within
 * @returns Array of intervals representing the expanded occurrences
 *
 * @example
 * const rule: RecurrenceRule = {
 *   frequency: 'weekly',
 *   days: ['monday', 'wednesday'],
 *   startTime: '09:00',
 *   endTime: '10:00',
 *   timezone: 'America/New_York'
 * };
 * const intervals = expandRecurrence(rule, { start: rangeStart, end: rangeEnd });
 */
export function expandRecurrence(rule: RecurrenceRule, range: DateRange): Interval[] {
	const intervals: Interval[] = [];
	let count = 0;
	const maxCount = rule.count ?? Infinity;

	// Determine the effective start and end for iteration
	// Extend the iteration window by 1 day on each side to handle timezone offsets
	// (a local day might start before or after the UTC day boundary)
	const effectiveStart = new Date(range.start.getTime() - 24 * 60 * 60 * 1000);
	const rangeEndExtended = new Date(range.end.getTime() + 24 * 60 * 60 * 1000);
	// Don't extend past the until date if specified
	const effectiveEnd = rule.until
		? new Date(Math.min(rangeEndExtended.getTime(), rule.until.getTime()))
		: rangeEndExtended;

	// Start iterating from extended range start, day by day
	let currentDate = new Date(effectiveStart);

	while (currentDate < effectiveEnd && count < maxCount) {
		const dayOfWeek = getDayOfWeekInTimezone(currentDate, rule.timezone);
		const dayOfMonth = getDayOfMonthInTimezone(currentDate, rule.timezone);

		let shouldInclude = false;

		switch (rule.frequency) {
			case 'daily':
				// Include every day, optionally filtered by days array
				shouldInclude = !rule.days || rule.days.includes(dayOfWeek);
				break;

			case 'weekly':
				// Include days that match the specified days array
				shouldInclude = rule.days?.includes(dayOfWeek) ?? false;
				break;

			case 'biweekly':
				// Include days matching the days array, but only every other week
				if (rule.days?.includes(dayOfWeek)) {
					const anchorDate = rule.start ?? range.start;
					shouldInclude = isInBiweeklyCycle(currentDate, anchorDate);
				}
				break;

			case 'monthly':
				// Include if the day of month matches
				shouldInclude = rule.dayOfMonth === dayOfMonth;
				break;
		}

		if (shouldInclude) {
			// Check exclusions
			if (!isExcluded(currentDate, rule.exclude, rule.timezone)) {
				// Convert local times to UTC
				const start = localTimeToUtc(currentDate, rule.startTime, rule.timezone);
				const end = localTimeToUtc(currentDate, rule.endTime, rule.timezone);

				// Only include if the interval is within the query range
				if (start >= range.start && end <= range.end) {
					intervals.push({ start, end });
					count++;
				} else if (start >= range.start && start < range.end) {
					// Partial overlap at the end - still include if start is in range
					intervals.push({ start, end });
					count++;
				}
			}
		}

		// Move to next day
		currentDate = addDays(currentDate, 1);
	}

	return intervals;
}

/**
 * Builds Block[] from a FreeBusyResponse (Google Calendar format).
 *
 * @param freebusy - The FreeBusyResponse from Google Calendar API
 * @param hostId - The host ID to attach to each block
 * @returns Array of Block objects representing busy periods
 *
 * @example
 * const freebusy: FreeBusyResponse = {
 *   calendars: {
 *     'primary': {
 *       busy: [{ start: '2024-01-15T10:00:00Z', end: '2024-01-15T11:00:00Z' }]
 *     }
 *   }
 * };
 * const blocks = buildBlocksFromFreebusy(freebusy, 'host-123');
 */
export function buildBlocksFromFreebusy(freebusy: FreeBusyResponse, hostId: HostId): Block[] {
	const blocks: Block[] = [];

	// Iterate through all calendars in the response
	for (const calendarId in freebusy.calendars) {
		const calendar = freebusy.calendars[calendarId];

		if (calendar.busy && Array.isArray(calendar.busy)) {
			for (const busyPeriod of calendar.busy) {
				// Handle both string and Date formats for start/end
				const start =
					busyPeriod.start instanceof Date ? busyPeriod.start : new Date(busyPeriod.start);

				const end = busyPeriod.end instanceof Date ? busyPeriod.end : new Date(busyPeriod.end);

				blocks.push({
					hostId,
					start,
					end,
				});
			}
		}
	}

	return blocks;
}
