/**
 * Slot Engine Type Definitions
 *
 * A stateless, composable slot generation library for Node.js.
 * All intervals are half-open: [start, end)
 * All times are UTC internally; timezone handling is the consumer's
 * responsibility at the input/output boundary.
 */

/**
 * The universal primitive for time ranges.
 * All intervals are half-open: [start, end)
 *
 * @example
 * const interval: Interval = {
 *   start: new Date('2024-01-15T09:00:00Z'),
 *   end: new Date('2024-01-15T10:00:00Z')
 * };
 */
export interface Interval {
	/** The start of the interval (inclusive) */
	start: Date;
	/** The end of the interval (exclusive) */
	end: Date;
}

/**
 * Days of the week used in schedule rules.
 * Lowercase string literals for consistent parsing.
 */
export type DayOfWeek =
	| 'monday'
	| 'tuesday'
	| 'wednesday'
	| 'thursday'
	| 'friday'
	| 'saturday'
	| 'sunday';

/**
 * A local time string in HH:MM format (24-hour).
 * Used in schedule rules to define daily availability windows.
 *
 * @example "09:00", "17:30", "00:00", "23:59"
 */
export type LocalTime = string;

/**
 * A point in time represented as a JavaScript Date object.
 * All DateTimes are UTC internally.
 */
export type DateTime = Date;

/**
 * A duration in milliseconds.
 * Used for event lengths, buffers, notice periods, etc.
 *
 * @example
 * const thirtyMinutes: Duration = 30 * 60 * 1000; // 1,800,000ms
 * const oneHour: Duration = 60 * 60 * 1000;       // 3,600,000ms
 */
export type Duration = number;

/**
 * Opaque identifier for a host.
 * A host is anyone or anything that can be booked (clinician, room, equipment).
 */
export type HostId = string;

/**
 * Defines a recurring pattern of availability within a schedule.
 * Rules are applied in local time and converted to UTC internally.
 *
 * @example
 * const weekdayRule: ScheduleRule = {
 *   days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
 *   startTime: '09:00',
 *   endTime: '17:00',
 *   timezone: 'America/New_York'
 * };
 */
export interface ScheduleRule {
	/** Days of the week this rule applies to */
	days: DayOfWeek[];
	/** Start time in HH:MM format (24-hour, local time) */
	startTime: LocalTime;
	/** End time in HH:MM format (24-hour, local time) */
	endTime: LocalTime;
	/** IANA timezone identifier (e.g., "America/New_York", "Europe/London") */
	timezone: string;
	/** Optional date when this rule takes effect (YYYY-MM-DD string or Date) */
	effectiveFrom?: string | Date;
	/** Optional date when this rule expires (YYYY-MM-DD string or Date) */
	effectiveUntil?: string | Date;
}

/**
 * Punches a hole in (or adds to) normal availability for a specific date.
 * Use to handle holidays, special hours, or one-time availability changes.
 *
 * @example
 * // Day off
 * const holidayOverride: ScheduleOverride = {
 *   date: new Date('2024-12-25'),
 *   available: false
 * };
 *
 * // Extra Saturday availability
 * const saturdayOverride: ScheduleOverride = {
 *   date: new Date('2024-01-20'),
 *   available: true,
 *   startTime: '10:00',
 *   endTime: '14:00'
 * };
 */
export interface ScheduleOverride {
	/** The specific date this override applies to (YYYY-MM-DD string or Date) */
	date: string | Date;
	/** true = add availability, false = remove availability */
	available: boolean;
	/** Optional start time; if omitted, applies to the full day */
	startTime?: LocalTime;
	/** Optional end time; if omitted, applies to the full day */
	endTime?: LocalTime;
}

/**
 * A named schedule containing recurring rules and optional overrides.
 * Hosts can have multiple schedules (e.g., "default", "telehealth").
 *
 * @example
 * const defaultSchedule: Schedule = {
 *   id: 'default',
 *   rules: [weekdayRule],
 *   overrides: [holidayOverride]
 * };
 */
export interface Schedule {
	/** Unique identifier for this schedule */
	id: string;
	/** Recurring availability rules */
	rules: ScheduleRule[];
	/** Optional date-specific overrides */
	overrides?: ScheduleOverride[];
}

/**
 * Associates a host with their named schedules.
 * A host can have multiple schedules selected by key (e.g., "default", "telehealth").
 *
 * @example
 * const hostSchedules: HostSchedules = {
 *   hostId: 'dr-smith-123',
 *   schedules: {
 *     default: defaultSchedule,
 *     telehealth: telehealthSchedule
 *   }
 * };
 */
export interface HostSchedules {
	/** The host's unique identifier */
	hostId: HostId;
	/** Map of schedule key to schedule definition */
	schedules: Record<string, Schedule>;
}

/**
 * Defines a bookable event type with scheduling constraints.
 * Event types carry configuration for length, buffers, and various limits.
 *
 * @example
 * const consultation: EventType = {
 *   id: 'initial-consultation',
 *   length: 60 * 60 * 1000, // 1 hour
 *   bufferBefore: 15 * 60 * 1000, // 15 min prep
 *   bufferAfter: 15 * 60 * 1000,  // 15 min notes
 *   slotInterval: 30 * 60 * 1000, // 30 min grid
 *   minimumNotice: 24 * 60 * 60 * 1000, // 24 hours
 *   maxPerDay: 4
 * };
 */
export interface EventType {
	/** Unique identifier for this event type */
	id: string;
	/** Duration of the event in milliseconds */
	length: Duration;
	/** Which host schedule to use; defaults to "default" */
	scheduleKey?: string;
	/** Blocked time before the slot (prep time) */
	bufferBefore?: Duration;
	/** Blocked time after the slot (wrap-up time) */
	bufferAfter?: Duration;
	/** Snap slots to this grid; defaults to length if not specified */
	slotInterval?: Duration;
	/** How far in advance the slot must be booked */
	minimumNotice?: Duration;
	/** How far into the future slots are offered */
	maximumLeadTime?: Duration;
	/** Maximum bookings of this type per host per day */
	maxPerDay?: number;
	/** Maximum bookings of this type per host per week */
	maxPerWeek?: number;
	/**
	 * Per-host customization without duplicating the entire event type.
	 * The resolved config is the event type merged with any host override,
	 * with the override winning.
	 */
	hostOverrides?: Record<HostId, Partial<Omit<EventType, 'id' | 'hostOverrides'>>>;
}

/**
 * An existing booking that consumes a host's time.
 * Bookings are subtracted from availability, with buffers inflated around them.
 *
 * @example
 * const existingBooking: Booking = {
 *   id: 'booking-456',
 *   hostId: 'dr-smith-123',
 *   start: new Date('2024-01-15T14:00:00Z'),
 *   end: new Date('2024-01-15T15:00:00Z'),
 *   eventTypeId: 'initial-consultation'
 * };
 */
export interface Booking {
	/** Optional unique identifier for this booking */
	id?: string;
	/** The host this booking belongs to */
	hostId: HostId;
	/** Start time of the booking (inclusive) */
	start: DateTime;
	/** End time of the booking (exclusive) */
	end: DateTime;
	/** Optional event type ID; used for maxPerDay/maxPerWeek counting */
	eventTypeId?: string;
}

/**
 * An external calendar event or manually defined busy period.
 * Blocks are treated identically to bookings when subtracting from availability,
 * but do not carry an event type for constraint counting.
 *
 * @example
 * const lunchBlock: Block = {
 *   hostId: 'dr-smith-123',
 *   start: new Date('2024-01-15T12:00:00Z'),
 *   end: new Date('2024-01-15T13:00:00Z')
 * };
 */
export interface Block {
	/** The host this block belongs to */
	hostId: HostId;
	/** Start time of the block (inclusive) */
	start: DateTime;
	/** End time of the block (exclusive) */
	end: DateTime;
}

/**
 * A bookable time slot returned by the engine.
 * Includes optional buffer information for display purposes.
 *
 * @example
 * const slot: Slot = {
 *   hostId: 'dr-smith-123',
 *   start: new Date('2024-01-15T09:00:00Z'),
 *   end: new Date('2024-01-15T10:00:00Z'),
 *   bufferBefore: {
 *     start: new Date('2024-01-15T08:45:00Z'),
 *     end: new Date('2024-01-15T09:00:00Z')
 *   }
 * };
 */
export interface Slot {
	/** The host this slot belongs to */
	hostId: HostId;
	/** Start time of the slot (inclusive) */
	start: DateTime;
	/** End time of the slot (exclusive); equals start + eventType.length */
	end: DateTime;
	/** The actual buffer window before the slot (informational) */
	bufferBefore?: Interval;
	/** The actual buffer window after the slot (informational) */
	bufferAfter?: Interval;
}

/**
 * A date range for querying availability.
 * All intervals are half-open: [start, end)
 *
 * @example
 * const nextWeek: DateRange = {
 *   start: new Date('2024-01-15T00:00:00Z'),
 *   end: new Date('2024-01-22T00:00:00Z')
 * };
 */
export interface DateRange {
	/** Start of the range (inclusive) */
	start: Date;
	/** End of the range (exclusive) */
	end: Date;
}

/**
 * Input for the primary getAvailableSlots query.
 * Provides all data needed to compute available booking slots.
 *
 * @example
 * const input: GetAvailableSlotsInput = {
 *   eventType: consultation,
 *   hosts: [drSmithSchedules, drJonesSchedules],
 *   bookings: existingBookings,
 *   blocks: calendarBlocks,
 *   range: {
 *     start: new Date('2024-01-15T00:00:00Z'),
 *     end: new Date('2024-01-22T00:00:00Z')
 *   }
 * };
 */
export interface GetAvailableSlotsInput {
	/** The event type being booked */
	eventType: EventType;
	/** One or more hosts to check availability for */
	hosts: HostSchedules[];
	/** Existing bookings across all hosts */
	bookings: Booking[];
	/** Optional external calendar blocks */
	blocks?: Block[];
	/** The date range to query for available slots */
	range: DateRange;
}

/**
 * Recurrence frequency options for expandRecurrence helper.
 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * Defines a recurring pattern for expandRecurrence helper.
 * Supports RRULE-like semantics with simplified structure.
 *
 * @example
 * const weeklyMeeting: RecurrenceRule = {
 *   frequency: 'weekly',
 *   days: ['monday', 'wednesday'],
 *   startTime: '10:00',
 *   endTime: '11:00',
 *   timezone: 'America/New_York',
 *   until: new Date('2024-12-31')
 * };
 */
export interface RecurrenceRule {
	/** Recurrence frequency */
	frequency: RecurrenceFrequency;
	/** Days of week (required for weekly/biweekly, optional for daily) */
	days?: DayOfWeek[];
	/** Day of month (for monthly frequency) */
	dayOfMonth?: number;
	/** Start time in HH:MM format */
	startTime: LocalTime;
	/** End time in HH:MM format */
	endTime: LocalTime;
	/** IANA timezone identifier */
	timezone: string;
	/** Optional anchor date for the recurrence pattern (used for biweekly, count) */
	start?: Date;
	/** Optional end date for the recurrence */
	until?: Date;
	/** Optional maximum number of occurrences */
	count?: number;
	/** Optional dates to exclude from the recurrence */
	exclude?: Date[];
}

/**
 * Busy time period from a calendar provider.
 */
export interface BusyPeriod {
	/** Start time as ISO string or Date */
	start: string | Date;
	/** End time as ISO string or Date */
	end: string | Date;
}

/**
 * Calendar data from a freebusy response.
 */
export interface CalendarBusy {
	/** List of busy periods */
	busy: BusyPeriod[];
}

/**
 * Response format compatible with Google Calendar FreeBusy API.
 * Used by buildBlocksFromFreebusy helper.
 *
 * @example
 * const freebusy: FreeBusyResponse = {
 *   calendars: {
 *     'primary': {
 *       busy: [
 *         { start: '2024-01-15T10:00:00Z', end: '2024-01-15T11:00:00Z' }
 *       ]
 *     }
 *   }
 * };
 */
export interface FreeBusyResponse {
	/** Map of calendar ID to busy periods */
	calendars: Record<string, CalendarBusy>;
}
