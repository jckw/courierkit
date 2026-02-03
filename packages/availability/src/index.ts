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
// Adapter-based engine
export { createAvailability } from './engine.js';

// All types
export type {
	Block,
	// Booking types
	AvailabilityAdapter,
	AvailabilityEngine,
	AvailabilityQuery,
	Booking,
	BusyPeriod,
	CalendarBusy,
	CreateAvailabilityOptions,
	DateRange,
	DateTime,
	DayOfWeek,
	Duration,
	EventTypeBufferConfig,
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
