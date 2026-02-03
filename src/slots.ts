/**
 * Main slot generation module for the availability engine.
 * Implements the 7-step algorithm to compute available booking slots.
 */

import { subtractIntervals } from './intervals.js';
import { expandSchedule } from './schedule.js';
import type {
	Booking,
	Duration,
	EventType,
	EventTypeBufferConfig,
	GetAvailableSlotsInput,
	HostId,
	Interval,
	Slot,
} from './types.js';

/**
 * Gets the ISO week number for a date.
 * Week starts on Monday (ISO 8601 standard).
 *
 * @param date - The date to get the week number for
 * @returns The ISO week number (1-53)
 */
function getISOWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	// Set to nearest Thursday: current date + 4 - current day number
	// Make Sunday day 7 instead of 0
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	// Get first day of year
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	// Calculate full weeks to nearest Thursday
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return weekNo;
}

/**
 * Gets the ISO week year for a date.
 * This may differ from the calendar year for dates near year boundaries.
 *
 * @param date - The date to get the ISO week year for
 * @returns The ISO week year
 */
function getISOWeekYear(date: Date): number {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	return d.getUTCFullYear();
}

/**
 * Gets the date key (YYYY-MM-DD) for a Date object in UTC.
 *
 * @param date - The date to format
 * @returns Date string in YYYY-MM-DD format
 */
function getDateKey(date: Date): string {
	return date.toISOString().split('T')[0];
}

/**
 * Gets the week key (YYYY-Www) for a Date object.
 * Uses ISO week numbering where weeks start on Monday.
 *
 * @param date - The date to format
 * @returns Week string in YYYY-Www format (e.g., "2024-W03")
 */
function getWeekKey(date: Date): string {
	const year = getISOWeekYear(date);
	const week = getISOWeek(date);
	return `${year}-W${week.toString().padStart(2, '0')}`;
}

/**
 * Resolves the effective configuration for a host by merging
 * the event type defaults with any host-specific overrides.
 *
 * @param eventType - The base event type configuration
 * @param hostId - The host ID to resolve config for
 * @returns Merged configuration with host overrides winning
 */
function resolveHostConfig(eventType: EventType, hostId: HostId): Omit<EventType, 'hostOverrides'> {
	const hostOverride = eventType.hostOverrides?.[hostId];
	if (!hostOverride) {
		return eventType;
	}

	return {
		...eventType,
		...hostOverride,
	};
}

/**
 * Inflates an interval by adding buffer time before and after.
 * Used to block buffer zones around existing bookings.
 *
 * @param interval - The interval to inflate
 * @param bufferBefore - Duration to add before the start
 * @param bufferAfter - Duration to add after the end
 * @returns The inflated interval
 */
function inflateInterval(
	interval: Interval,
	bufferBefore: Duration,
	bufferAfter: Duration,
): Interval {
	return {
		start: new Date(interval.start.getTime() - bufferBefore),
		end: new Date(interval.end.getTime() + bufferAfter),
	};
}

/**
 * Counts existing bookings per day and per week for a specific host and event type.
 *
 * @param bookings - All bookings to count
 * @param hostId - The host to filter by
 * @param eventTypeId - The event type to filter by
 * @returns Object with dayCount and weekCount maps
 */
function countBookings(
	bookings: Booking[],
	hostId: HostId,
	eventTypeId: string,
): {
	dayCount: Map<string, number>;
	weekCount: Map<string, number>;
} {
	const dayCount = new Map<string, number>();
	const weekCount = new Map<string, number>();

	for (const booking of bookings) {
		if (booking.hostId !== hostId || booking.eventTypeId !== eventTypeId) {
			continue;
		}

		const dayKey = getDateKey(booking.start);
		const weekKey = getWeekKey(booking.start);

		dayCount.set(dayKey, (dayCount.get(dayKey) ?? 0) + 1);
		weekCount.set(weekKey, (weekCount.get(weekKey) ?? 0) + 1);
	}

	return { dayCount, weekCount };
}

/**
 * Generates candidate slots from free intervals at regular intervals.
 * Per Addendum A: The inflated slot (slot + buffers) must fit entirely within free space.
 *
 * @param freeIntervals - Available time intervals
 * @param slotLength - Duration of each slot
 * @param slotInterval - Step size between slot starts
 * @param hostId - The host these slots belong to
 * @param bufferBefore - Buffer duration before the slot
 * @param bufferAfter - Buffer duration after the slot
 * @returns Array of candidate slots
 */
function generateCandidateSlots(
	freeIntervals: Interval[],
	slotLength: Duration,
	slotInterval: Duration,
	hostId: HostId,
	bufferBefore: Duration,
	bufferAfter: Duration,
): Slot[] {
	const slots: Slot[] = [];

	for (const interval of freeIntervals) {
		// The inflated slot must fit within the free interval
		// Inflated slot: [slotStart - bufferBefore, slotEnd + bufferAfter)
		// So we need: slotStart - bufferBefore >= interval.start
		//         and: slotEnd + bufferAfter <= interval.end
		const intervalStart = interval.start.getTime();
		const intervalEnd = interval.end.getTime();

		// Earliest possible slot start: interval start + bufferBefore
		let slotStart = intervalStart + bufferBefore;

		// Walk through the interval, placing slots at every slotInterval step
		// The inflated slot [slotStart - bufferBefore, slotEnd + bufferAfter) must fit
		while (slotStart + slotLength + bufferAfter <= intervalEnd) {
			const slotEnd = slotStart + slotLength;

			const slot: Slot = {
				hostId,
				start: new Date(slotStart),
				end: new Date(slotEnd),
			};

			// Add buffer information if buffers are configured
			if (bufferBefore > 0) {
				slot.bufferBefore = {
					start: new Date(slotStart - bufferBefore),
					end: new Date(slotStart),
				};
			}

			if (bufferAfter > 0) {
				slot.bufferAfter = {
					start: new Date(slotEnd),
					end: new Date(slotEnd + bufferAfter),
				};
			}

			slots.push(slot);
			slotStart += slotInterval;
		}
	}

	return slots;
}

/**
 * Computes available booking slots for the given input.
 *
 * This function implements a 7-step algorithm for each host:
 * 1. **Expand schedule** - Convert recurring rules to UTC intervals
 * 2. **Subtract busy intervals** - Remove bookings (inflated by buffers) and blocks
 * 3. **Apply minimum notice** - Remove intervals starting before now + minimumNotice
 * 4. **Apply maximum lead time** - Clamp range end to now + maximumLeadTime
 * 5. **Generate candidate slots** - Walk free intervals at slotInterval steps
 * 6. **Apply daily/weekly caps** - Skip slots on days/weeks at capacity
 * 7. **Collect and sort** - Merge across hosts, sort by start time then hostId
 *
 * @param input - The input containing event type, hosts, bookings, blocks, and date range
 * @param now - Optional current time (defaults to new Date())
 * @returns Array of available slots sorted by start time, then by hostId
 *
 * @example
 * ```typescript
 * // Basic usage with a single host
 * const slots = getAvailableSlots({
 *   eventType: {
 *     id: 'consultation',
 *     length: 60 * 60 * 1000, // 1 hour
 *     bufferBefore: 15 * 60 * 1000,
 *     bufferAfter: 15 * 60 * 1000,
 *     minimumNotice: 24 * 60 * 60 * 1000, // 24 hours
 *     maxPerDay: 4,
 *   },
 *   hosts: [{
 *     hostId: 'dr-smith',
 *     schedules: {
 *       default: {
 *         id: 'default',
 *         rules: [{
 *           days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
 *           startTime: '09:00',
 *           endTime: '17:00',
 *           timezone: 'America/New_York',
 *         }],
 *       },
 *     },
 *   }],
 *   bookings: [{
 *     hostId: 'dr-smith',
 *     start: new Date('2024-01-15T14:00:00Z'),
 *     end: new Date('2024-01-15T15:00:00Z'),
 *     eventTypeId: 'consultation',
 *   }],
 *   range: {
 *     start: new Date('2024-01-15T00:00:00Z'),
 *     end: new Date('2024-01-22T00:00:00Z'),
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using host overrides for per-host configuration
 * const slots = getAvailableSlots({
 *   eventType: {
 *     id: 'therapy-session',
 *     length: 50 * 60 * 1000, // 50 minutes
 *     slotInterval: 60 * 60 * 1000, // 1 hour grid
 *     maxPerDay: 6,
 *     hostOverrides: {
 *       'dr-jones': {
 *         maxPerDay: 4, // Dr. Jones has a lower daily limit
 *         bufferAfter: 20 * 60 * 1000, // Extra buffer for notes
 *       },
 *     },
 *   },
 *   hosts: [drSmithSchedules, drJonesSchedules],
 *   bookings: existingBookings,
 *   blocks: calendarBlocks,
 *   range: nextWeek,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using a custom schedule key
 * const telehealthSlots = getAvailableSlots({
 *   eventType: {
 *     id: 'telehealth-visit',
 *     length: 30 * 60 * 1000,
 *     scheduleKey: 'telehealth', // Uses telehealth schedule instead of default
 *   },
 *   hosts: [{
 *     hostId: 'dr-smith',
 *     schedules: {
 *       default: regularSchedule,
 *       telehealth: telehealthSchedule, // Extended hours for virtual visits
 *     },
 *   }],
 *   bookings: [],
 *   range: nextWeek,
 * });
 * ```
 */
export function getAvailableSlots(input: GetAvailableSlotsInput, now?: Date): Slot[] {
	const currentTime = now ?? new Date();
	const { eventType, hosts, bookings, blocks = [], range } = input;

	const allSlots: Slot[] = [];

	// Process each host independently
	for (const hostSchedules of hosts) {
		const hostId = hostSchedules.hostId;

		// Resolve host-specific configuration
		const config = resolveHostConfig(eventType, hostId);

		// Get configuration values with defaults
		const scheduleKey = config.scheduleKey ?? 'default';
		const slotLength = config.length;
		const slotInterval = config.slotInterval ?? slotLength;
		const bufferBefore = config.bufferBefore ?? 0;
		const bufferAfter = config.bufferAfter ?? 0;
		const minimumNotice = config.minimumNotice ?? 0;
		const maximumLeadTime = config.maximumLeadTime;
		const maxPerDay = config.maxPerDay;
		const maxPerWeek = config.maxPerWeek;

		// Get the schedule for this host
		const schedule = hostSchedules.schedules[scheduleKey];
		if (!schedule) {
			// No schedule found, skip this host
			continue;
		}

		// Step 1: Expand schedule to get availability intervals
		let freeIntervals = expandSchedule(schedule, range);

		// Step 2: Subtract busy intervals (bookings and blocks for this host)
		// Per Addendum A: Each booking is inflated by its OWN event type's buffers,
		// not the queried event type's buffers.
		const hostBookings = bookings.filter((b) => b.hostId === hostId);
		const hostBlocks = blocks.filter((b) => b.hostId === hostId);

		// Inflate bookings by their OWN event type's buffer amounts
		const busyIntervals: Interval[] = [
			...hostBookings.map((booking) => {
				// Look up this booking's event type buffers from the eventTypes map
				const bookingEventTypeConfig = booking.eventTypeId
					? input.eventTypes?.[booking.eventTypeId]
					: undefined;
				const bookingBufferBefore = bookingEventTypeConfig?.bufferBefore ?? 0;
				const bookingBufferAfter = bookingEventTypeConfig?.bufferAfter ?? 0;
				return inflateInterval(
					{ start: booking.start, end: booking.end },
					bookingBufferBefore,
					bookingBufferAfter,
				);
			}),
			...hostBlocks.map((block) => ({ start: block.start, end: block.end })),
		];

		if (busyIntervals.length > 0) {
			freeIntervals = subtractIntervals(freeIntervals, busyIntervals);
		}

		// Step 3: Apply minimum notice - remove any time before now + minimumNotice
		const earliestStart = new Date(currentTime.getTime() + minimumNotice);
		freeIntervals = freeIntervals
			.map((interval) => ({
				start: new Date(Math.max(interval.start.getTime(), earliestStart.getTime())),
				end: interval.end,
			}))
			.filter((interval) => interval.start < interval.end);

		// Step 4: Apply maximum lead time - clamp range end
		if (maximumLeadTime !== undefined) {
			const latestEnd = new Date(currentTime.getTime() + maximumLeadTime);
			freeIntervals = freeIntervals
				.map((interval) => ({
					start: interval.start,
					end: new Date(Math.min(interval.end.getTime(), latestEnd.getTime())),
				}))
				.filter((interval) => interval.start < interval.end);
		}

		// Step 5: Generate candidate slots
		const candidateSlots = generateCandidateSlots(
			freeIntervals,
			slotLength,
			slotInterval,
			hostId,
			bufferBefore,
			bufferAfter,
		);

		// Step 6: Apply daily/weekly caps
		if (maxPerDay !== undefined || maxPerWeek !== undefined) {
			const { dayCount, weekCount } = countBookings(bookings, hostId, eventType.id);

			// Track counts for new candidate slots to avoid exceeding caps
			const candidateDayCount = new Map<string, number>();
			const candidateWeekCount = new Map<string, number>();

			for (const slot of candidateSlots) {
				const dayKey = getDateKey(slot.start);
				const weekKey = getWeekKey(slot.start);

				// Check daily cap
				if (maxPerDay !== undefined) {
					const existingDayCount = dayCount.get(dayKey) ?? 0;
					const candidateDayCountForDay = candidateDayCount.get(dayKey) ?? 0;
					if (existingDayCount + candidateDayCountForDay >= maxPerDay) {
						continue; // Skip this slot, day is at capacity
					}
				}

				// Check weekly cap
				if (maxPerWeek !== undefined) {
					const existingWeekCount = weekCount.get(weekKey) ?? 0;
					const candidateWeekCountForWeek = candidateWeekCount.get(weekKey) ?? 0;
					if (existingWeekCount + candidateWeekCountForWeek >= maxPerWeek) {
						continue; // Skip this slot, week is at capacity
					}
				}

				// Slot passes all caps, add to results
				allSlots.push(slot);

				// Update candidate counts for subsequent checks within this host
				candidateDayCount.set(dayKey, (candidateDayCount.get(dayKey) ?? 0) + 1);
				candidateWeekCount.set(weekKey, (candidateWeekCount.get(weekKey) ?? 0) + 1);
			}
		} else {
			// No caps, add all candidate slots
			allSlots.push(...candidateSlots);
		}
	}

	// Step 7: Sort by start time, then by hostId for consistent ordering
	allSlots.sort((a, b) => {
		const startDiff = a.start.getTime() - b.start.getTime();
		if (startDiff !== 0) return startDiff;
		return a.hostId.localeCompare(b.hostId);
	});

	return allSlots;
}
