/**
 * Slot Engine
 *
 * A stateless, composable slot generation library for Node.js.
 * Given schedules, bookings, external calendar events, and event type configuration,
 * it answers the question: "When can this happen?"
 *
 * @packageDocumentation
 */

// Helper functions
export { buildBlocksFromFreebusy, expandRecurrence } from './helpers.js';
// Interval arithmetic
export { intersectIntervals, mergeIntervals, subtractIntervals } from './intervals.js';
// Schedule expansion
export { expandSchedule } from './schedule.js';
// Main query function
export { getAvailableSlots } from './slots.js';

// All types
export type {
	Block,
	// Booking types
	Booking,
	BusyPeriod,
	CalendarBusy,
	DateRange,
	DateTime,
	DayOfWeek,
	Duration,
	// Event types
	EventType,
	FreeBusyResponse,
	// Query types
	GetAvailableSlotsInput,
	HostId,
	HostSchedules,
	// Core primitives
	Interval,
	LocalTime,
	RecurrenceFrequency,
	// Helper types
	RecurrenceRule,
	Schedule,
	ScheduleOverride,
	// Schedule types
	ScheduleRule,
	Slot,
} from './types.js';
