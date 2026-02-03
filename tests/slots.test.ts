import { describe, expect, test } from 'bun:test';
import { getAvailableSlots } from '../src/slots.js';
import type { Booking, EventType, GetAvailableSlotsInput, HostSchedules } from '../src/types.js';

const d = (iso: string) => new Date(iso);
const minutes = (n: number) => n * 60 * 1000;
const hours = (n: number) => n * 60 * 60 * 1000;

// Default "now" for tests - before the test date ranges
const testNow = d('2024-01-01T00:00:00Z');

describe('getAvailableSlots', () => {
	const defaultEventType: EventType = {
		id: 'consultation',
		length: minutes(30),
	};

	const defaultHost: HostSchedules = {
		hostId: 'host-1',
		schedules: {
			default: {
				id: 'default',
				rules: [
					{
						days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
						startTime: '09:00',
						endTime: '17:00',
						timezone: 'UTC',
					},
				],
			},
		},
	};

	test('generates slots for available time', () => {
		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-01T00:00:00Z'), // Monday
				end: d('2024-01-02T00:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// 8 hours = 480 minutes / 30 = 16 slots
		expect(slots).toHaveLength(16);
		expect(slots[0]).toMatchObject({
			hostId: 'host-1',
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T09:30:00Z'),
		});
		expect(slots[15]).toMatchObject({
			hostId: 'host-1',
			start: d('2024-01-01T16:30:00Z'),
			end: d('2024-01-01T17:00:00Z'),
		});
	});

	test('excludes time blocked by bookings', () => {
		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost],
			bookings: [
				{
					hostId: 'host-1',
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T11:00:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T12:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// 9:00-10:00 = 2 slots, 11:00-12:00 = 2 slots
		expect(slots).toHaveLength(4);
		expect(slots.map((s) => s.start.toISOString())).toEqual([
			'2024-01-01T09:00:00.000Z',
			'2024-01-01T09:30:00.000Z',
			'2024-01-01T11:00:00.000Z',
			'2024-01-01T11:30:00.000Z',
		]);
	});

	test('excludes time blocked by external blocks', () => {
		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost],
			bookings: [],
			blocks: [
				{
					hostId: 'host-1',
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T11:00:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T12:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		expect(slots).toHaveLength(4);
	});

	test('respects bufferBefore', () => {
		// Per Addendum A: The candidate slot's inflated interval must fit within free space.
		// bufferBefore on the queried event means the slot needs prep time before it.
		const eventTypeWithBuffer: EventType = {
			...defaultEventType,
			bufferBefore: minutes(15),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithBuffer,
			hosts: [defaultHost],
			bookings: [
				{
					hostId: 'host-1',
					eventTypeId: 'consultation',
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T10:30:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T11:00:00Z'),
			},
			eventTypes: {
				consultation: {
					bufferBefore: 0,
					bufferAfter: 0,
				},
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Booking (with 0 own buffers) blocks [10:00, 10:30)
		// Free intervals: [09:00, 10:00) and [10:30, 11:00)
		// For candidate slots with 15min bufferBefore, 30min length:
		// - Slot at 9:00: inflated [8:45, 9:30) - 8:45 < 9:00, doesn't fit
		// - Slot at 9:15: inflated [9:00, 9:45) - fits in [9:00, 10:00)
		// - Slot at 9:45: inflated [9:30, 10:15) - 10:15 > 10:00, doesn't fit in [9:00, 10:00)
		// - Slot at 10:30: inflated [10:15, 11:00) - fits in [10:30, 11:00)? No! 10:15 < 10:30
		// - Slot at 10:45: inflated [10:30, 11:15) - 11:15 > 11:00, doesn't fit
		const startTimes = slots.map((s) => s.start.toISOString());
		expect(startTimes).not.toContain('2024-01-01T09:00:00.000Z'); // bufferBefore extends before schedule
		expect(startTimes).toContain('2024-01-01T09:15:00.000Z'); // first available slot
		expect(startTimes).not.toContain('2024-01-01T09:45:00.000Z'); // inflated extends past booking
		expect(startTimes).not.toContain('2024-01-01T10:30:00.000Z'); // bufferBefore extends into booking
	});

	test('respects bufferAfter', () => {
		// Per Addendum A: The candidate slot's inflated interval must fit within free space.
		// bufferAfter on the queried event means wrap-up time after the slot.
		const eventTypeWithBuffer: EventType = {
			...defaultEventType,
			bufferAfter: minutes(15),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithBuffer,
			hosts: [defaultHost],
			bookings: [
				{
					hostId: 'host-1',
					eventTypeId: 'consultation',
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T10:30:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T12:00:00Z'),
			},
			eventTypes: {
				consultation: {
					bufferBefore: 0,
					bufferAfter: 0,
				},
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Booking (with 0 own buffers) blocks [10:00, 10:30)
		// Free intervals: [09:00, 10:00) and [10:30, 12:00)
		// For candidate slots with 15min bufferAfter, 30min length:
		// - Slot at 9:00: inflated [9:00, 9:45) - fits in [9:00, 10:00)
		// - Slot at 9:30: inflated [9:30, 10:15) - 10:15 > 10:00, doesn't fit in first interval
		// - Slot at 10:30: inflated [10:30, 11:15) - fits in [10:30, 12:00)
		// - Slot at 11:30: inflated [11:30, 12:15) - 12:15 > 12:00, doesn't fit
		const startTimes = slots.map((s) => s.start.toISOString());
		expect(startTimes).toContain('2024-01-01T09:00:00.000Z');
		expect(startTimes).not.toContain('2024-01-01T09:30:00.000Z'); // bufferAfter extends into booking
		expect(startTimes).toContain('2024-01-01T10:30:00.000Z'); // available after booking
		expect(startTimes).not.toContain('2024-01-01T11:30:00.000Z'); // bufferAfter extends past schedule
	});

	test('respects minimumNotice', () => {
		const now = d('2024-01-01T09:30:00Z');
		const eventTypeWithNotice: EventType = {
			...defaultEventType,
			minimumNotice: hours(1),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithNotice,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T12:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, now);

		// First available is 10:30 (now + 1 hour)
		expect(slots[0].start).toEqual(d('2024-01-01T10:30:00Z'));
	});

	test('respects maximumLeadTime', () => {
		const now = d('2024-01-01T08:00:00Z');
		const eventTypeWithLead: EventType = {
			...defaultEventType,
			maximumLeadTime: hours(3),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithLead,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T17:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, now);

		// Last slot must end by 11:00 (now + 3 hours)
		const lastSlot = slots[slots.length - 1];
		expect(lastSlot.end.getTime()).toBeLessThanOrEqual(d('2024-01-01T11:00:00Z').getTime());
	});

	test('respects slotInterval', () => {
		const eventTypeWithInterval: EventType = {
			...defaultEventType,
			slotInterval: minutes(15),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithInterval,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T10:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// With 15-minute intervals and 30-minute length, we get slots at 9:00, 9:15, 9:30
		// (9:45 won't fit because slot would end at 10:15, past the range end)
		expect(slots).toHaveLength(3);
		expect(slots[0].start).toEqual(d('2024-01-01T09:00:00Z'));
		expect(slots[1].start).toEqual(d('2024-01-01T09:15:00Z'));
		expect(slots[2].start).toEqual(d('2024-01-01T09:30:00Z'));
	});

	test('respects maxPerDay', () => {
		const eventTypeWithMax: EventType = {
			...defaultEventType,
			maxPerDay: 2,
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithMax,
			hosts: [defaultHost],
			bookings: [
				{
					hostId: 'host-1',
					eventTypeId: 'consultation',
					start: d('2024-01-01T09:00:00Z'),
					end: d('2024-01-01T09:30:00Z'),
				},
				{
					hostId: 'host-1',
					eventTypeId: 'consultation',
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T10:30:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T00:00:00Z'),
				end: d('2024-01-03T00:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// No slots on Monday (already at max), all slots on Tuesday
		const mondaySlots = slots.filter((s) => s.start.toISOString().startsWith('2024-01-01'));
		const tuesdaySlots = slots.filter((s) => s.start.toISOString().startsWith('2024-01-02'));

		expect(mondaySlots).toHaveLength(0);
		expect(tuesdaySlots.length).toBeGreaterThan(0);
	});

	test('respects maxPerWeek', () => {
		const eventTypeWithMax: EventType = {
			...defaultEventType,
			maxPerWeek: 3,
		};

		// Create 3 existing bookings
		const bookings: Booking[] = [
			{
				hostId: 'host-1',
				eventTypeId: 'consultation',
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T09:30:00Z'),
			},
			{
				hostId: 'host-1',
				eventTypeId: 'consultation',
				start: d('2024-01-02T09:00:00Z'),
				end: d('2024-01-02T09:30:00Z'),
			},
			{
				hostId: 'host-1',
				eventTypeId: 'consultation',
				start: d('2024-01-03T09:00:00Z'),
				end: d('2024-01-03T09:30:00Z'),
			},
		];

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithMax,
			hosts: [defaultHost],
			bookings,
			range: {
				start: d('2024-01-01T00:00:00Z'),
				end: d('2024-01-08T00:00:00Z'), // Entire week
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Should have no slots this week (already at max)
		expect(slots).toHaveLength(0);
	});

	test('handles multiple hosts', () => {
		const host2: HostSchedules = {
			hostId: 'host-2',
			schedules: {
				default: {
					id: 'default',
					rules: [
						{
							days: ['monday'],
							startTime: '09:00',
							endTime: '10:00',
							timezone: 'UTC',
						},
					],
				},
			},
		};

		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost, host2],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T10:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		const host1Slots = slots.filter((s) => s.hostId === 'host-1');
		const host2Slots = slots.filter((s) => s.hostId === 'host-2');

		expect(host1Slots).toHaveLength(2);
		expect(host2Slots).toHaveLength(2);
	});

	test('uses hostOverrides for specific host', () => {
		// Use 15-minute slots to test host-specific buffer configurations
		// Per Addendum A: Candidate slot's inflated interval must fit in free space
		const eventTypeWithOverride: EventType = {
			id: 'short-consultation',
			length: minutes(15),
			bufferAfter: minutes(5),
			hostOverrides: {
				'host-1': {
					bufferAfter: minutes(30),
				},
			},
		};

		const host2: HostSchedules = {
			hostId: 'host-2',
			schedules: {
				default: {
					id: 'default',
					rules: [
						{
							days: ['monday'],
							startTime: '09:00',
							endTime: '11:00', // Extended to allow more slots
							timezone: 'UTC',
						},
					],
				},
			},
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithOverride,
			hosts: [defaultHost, host2],
			bookings: [
				{
					hostId: 'host-1',
					eventTypeId: 'short-consultation',
					start: d('2024-01-01T09:30:00Z'),
					end: d('2024-01-01T09:45:00Z'),
				},
				{
					hostId: 'host-2',
					eventTypeId: 'short-consultation',
					start: d('2024-01-01T09:30:00Z'),
					end: d('2024-01-01T09:45:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T11:00:00Z'),
			},
			eventTypes: {
				'short-consultation': {
					bufferBefore: 0,
					bufferAfter: minutes(5), // Booking's own buffer
				},
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Both bookings inflated by their OWN buffer (5min after): busy [9:30, 9:50)
		// Free for both hosts: [9:00, 9:30) and [9:50, 11:00)
		//
		// Host 1 (30min bufferAfter for candidates):
		// - Slot at 9:00: inflated [9:00, 9:45) - fits in [9:00, 9:30)? No! 9:45 > 9:30
		// - Slot at 9:50: inflated [9:50, 10:35) - fits in [9:50, 11:00)? Yes!
		// - Slot at 10:05: inflated [10:05, 10:50) - fits
		// - Slot at 10:20: inflated [10:20, 11:05) - 11:05 > 11:00, doesn't fit
		//
		// Host 2 (5min bufferAfter for candidates):
		// - Slot at 9:00: inflated [9:00, 9:20) - fits in [9:00, 9:30)? Yes!
		// - Slot at 9:15: inflated [9:15, 9:35) - 9:35 > 9:30, doesn't fit
		// - Slot at 9:50: inflated [9:50, 10:10) - fits in [9:50, 11:00)? Yes!
		const host1Slots = slots.filter((s) => s.hostId === 'host-1');
		const host2Slots = slots.filter((s) => s.hostId === 'host-2');

		// Host 1: no slots before booking (buffer too large), slots from 9:50
		expect(host1Slots.map((s) => s.start.toISOString())).not.toContain('2024-01-01T09:00:00.000Z');
		expect(host1Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T09:50:00.000Z');
		expect(host1Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T10:05:00.000Z');

		// Host 2: has slot at 9:00 (shorter buffer fits before booking)
		expect(host2Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T09:00:00.000Z');
		expect(host2Slots.map((s) => s.start.toISOString())).not.toContain('2024-01-01T09:15:00.000Z');
		expect(host2Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T09:50:00.000Z');
	});

	test('sorts results by start then hostId', () => {
		const host2: HostSchedules = {
			hostId: 'host-2',
			schedules: {
				default: defaultHost.schedules.default,
			},
		};

		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost, host2],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T10:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Should be sorted by start time, then by host ID
		expect(slots[0]).toMatchObject({ start: d('2024-01-01T09:00:00Z'), hostId: 'host-1' });
		expect(slots[1]).toMatchObject({ start: d('2024-01-01T09:00:00Z'), hostId: 'host-2' });
		expect(slots[2]).toMatchObject({ start: d('2024-01-01T09:30:00Z'), hostId: 'host-1' });
		expect(slots[3]).toMatchObject({ start: d('2024-01-01T09:30:00Z'), hostId: 'host-2' });
	});

	test('uses scheduleKey from event type', () => {
		const hostWithMultipleSchedules: HostSchedules = {
			hostId: 'host-1',
			schedules: {
				default: {
					id: 'default',
					rules: [
						{
							days: ['monday'],
							startTime: '09:00',
							endTime: '12:00',
							timezone: 'UTC',
						},
					],
				},
				telehealth: {
					id: 'telehealth',
					rules: [
						{
							days: ['monday'],
							startTime: '14:00',
							endTime: '17:00',
							timezone: 'UTC',
						},
					],
				},
			},
		};

		const telehealthEventType: EventType = {
			id: 'telehealth-visit',
			length: minutes(30),
			scheduleKey: 'telehealth',
		};

		const input: GetAvailableSlotsInput = {
			eventType: telehealthEventType,
			hosts: [hostWithMultipleSchedules],
			bookings: [],
			range: {
				start: d('2024-01-01T00:00:00Z'),
				end: d('2024-01-02T00:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Should only have afternoon slots from telehealth schedule
		expect(slots[0].start).toEqual(d('2024-01-01T14:00:00Z'));
	});

	test('returns empty array when no availability', () => {
		const input: GetAvailableSlotsInput = {
			eventType: defaultEventType,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-06T00:00:00Z'), // Saturday
				end: d('2024-01-07T00:00:00Z'), // Sunday
			},
		};

		const slots = getAvailableSlots(input, testNow);
		expect(slots).toEqual([]);
	});

	test('includes buffer intervals in slot metadata', () => {
		// Per Addendum A: Candidate slot's inflated interval must fit in free space
		// First slot starts at schedule.start + bufferBefore
		const eventTypeWithBuffers: EventType = {
			...defaultEventType,
			bufferBefore: minutes(10),
			bufferAfter: minutes(15),
		};

		const input: GetAvailableSlotsInput = {
			eventType: eventTypeWithBuffers,
			hosts: [defaultHost],
			bookings: [],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T10:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Free interval: [9:00, 10:00)
		// For a slot at time T with 10min bufferBefore and 15min bufferAfter:
		// Inflated interval: [T-10min, T+30min+15min] = [T-10, T+45]
		// First slot can start at 9:10 (so inflated is [9:00, 9:55))
		// This fits in [9:00, 10:00)
		expect(slots[0].start).toEqual(d('2024-01-01T09:10:00Z'));
		expect(slots[0].bufferBefore).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T09:10:00Z'),
		});
		expect(slots[0].bufferAfter).toEqual({
			start: d('2024-01-01T09:40:00Z'),
			end: d('2024-01-01T09:55:00Z'),
		});
	});

	describe('Addendum A: Buffer model correction', () => {
		// Per Addendum A: Each booking is inflated by its OWN event type's buffers,
		// not the queried event type's buffers.

		test('bookings are inflated by their OWN event type buffers', () => {
			// Querying for follow_up (0 before, 5 after buffer)
			// Existing booking is initial_visit (0 before, 15 after buffer)
			// The booking should block: 10:00-10:30 + 15min after = 10:00-10:45
			const followUpEventType: EventType = {
				id: 'follow_up',
				length: minutes(30),
				bufferBefore: 0,
				bufferAfter: minutes(5),
			};

			const input: GetAvailableSlotsInput = {
				eventType: followUpEventType,
				hosts: [defaultHost],
				bookings: [
					{
						hostId: 'host-1',
						eventTypeId: 'initial_visit',
						start: d('2024-01-01T10:00:00Z'),
						end: d('2024-01-01T10:30:00Z'),
					},
				],
				range: {
					start: d('2024-01-01T09:00:00Z'),
					end: d('2024-01-01T12:00:00Z'),
				},
				eventTypes: {
					initial_visit: {
						bufferBefore: 0,
						bufferAfter: minutes(15), // 15 min wrap-up
					},
					follow_up: {
						bufferBefore: 0,
						bufferAfter: minutes(5),
					},
				},
			};

			const slots = getAvailableSlots(input, testNow);
			const startTimes = slots.map((s) => s.start.toISOString());

			// Booking inflated by its OWN buffers: 10:00-10:45 is blocked
			// Slots before 10:00 are available: 9:00, 9:30
			// For candidate slot at 9:30-10:00, inflated is 9:30-10:05, which overlaps blocked 10:00-10:45
			// So 9:30 should NOT be available (its bufferAfter extends into blocked time)
			expect(startTimes).toContain('2024-01-01T09:00:00.000Z');
			// 9:30 slot with 5min bufferAfter ends at 10:05, need to check if free
			// Actually the free intervals after subtracting [10:00, 10:45) are:
			// [9:00, 10:00) and [10:45, 12:00)
			// For 9:30 slot (30min length, 5min bufferAfter), inflated is [9:30, 10:05)
			// This must fit in free space. 10:05 > 10:00, so it doesn't fit in [9:00, 10:00)
			// Therefore 9:30 should NOT be available

			// Actually wait, let me re-check the algorithm:
			// After subtracting busy intervals, free = [9:00, 10:00) and [10:45, 12:00)
			// For candidate generation, we need inflated slot to fit:
			// - Slot at 9:00: inflated [9:00-0, 9:30+5min] = [9:00, 9:35) - fits in [9:00, 10:00)
			// - Slot at 9:30: inflated [9:30-0, 10:00+5min] = [9:30, 10:05) - does NOT fit in [9:00, 10:00)
			// So only 9:00 is available before the booking

			expect(startTimes).not.toContain('2024-01-01T09:30:00.000Z');

			// Slots at 10:45 onwards should be available
			expect(startTimes).toContain('2024-01-01T10:45:00.000Z');
			expect(startTimes).toContain('2024-01-01T11:15:00.000Z');
		});

		test('worked example from Addendum A: Dr. Patel follow-up slots', () => {
			// Dr. Patel available 09:00-12:00 UTC on Monday
			// Has one existing initial_visit at 10:00-10:30
			// Query for follow_up slots
			const drPatel: HostSchedules = {
				hostId: 'dr-patel',
				schedules: {
					default: {
						id: 'default',
						rules: [
							{
								days: ['monday'],
								startTime: '09:00',
								endTime: '12:00',
								timezone: 'UTC',
							},
						],
					},
				},
			};

			const followUpEventType: EventType = {
				id: 'follow_up',
				length: minutes(30),
				bufferBefore: 0,
				bufferAfter: minutes(5), // 5 min notes
			};

			const input: GetAvailableSlotsInput = {
				eventType: followUpEventType,
				hosts: [drPatel],
				bookings: [
					{
						id: 'booking-1',
						hostId: 'dr-patel',
						eventTypeId: 'initial_visit',
						start: d('2024-01-01T10:00:00Z'),
						end: d('2024-01-01T10:30:00Z'),
					},
				],
				range: {
					start: d('2024-01-01T09:00:00Z'),
					end: d('2024-01-01T12:00:00Z'),
				},
				eventTypes: {
					initial_visit: {
						bufferBefore: 0,
						bufferAfter: minutes(15), // 15 min wrap-up for initial visits
					},
					follow_up: {
						bufferBefore: 0,
						bufferAfter: minutes(5),
					},
				},
			};

			const slots = getAvailableSlots(input, testNow);
			const startTimes = slots.map((s) => s.start.toISOString());

			// Per Addendum A worked example:
			// Busy interval: [10:00, 10:45) - booking inflated by its OWN 15min after buffer
			// Free intervals: [09:00, 10:00) and [10:45, 12:00)

			// Candidate slots with follow_up (5min after buffer):
			// 09:00: inflated [09:00, 09:35) fits in [09:00, 10:00) ✓
			// 09:30: inflated [09:30, 10:05) does NOT fit in [09:00, 10:00) ✗
			// 10:45: inflated [10:45, 11:20) fits in [10:45, 12:00) ✓
			// 11:15: inflated [11:15, 11:50) fits in [10:45, 12:00) ✓
			// 11:45: inflated [11:45, 12:20) does NOT fit in [10:45, 12:00) ✗

			expect(startTimes).toEqual([
				'2024-01-01T09:00:00.000Z',
				'2024-01-01T10:45:00.000Z',
				'2024-01-01T11:15:00.000Z',
			]);
		});

		test('booking without eventTypeId has zero buffers', () => {
			// When a booking has no eventTypeId, it should be treated as having zero buffers
			const followUpEventType: EventType = {
				id: 'follow_up',
				length: minutes(30),
				bufferBefore: 0,
				bufferAfter: minutes(5),
			};

			const input: GetAvailableSlotsInput = {
				eventType: followUpEventType,
				hosts: [defaultHost],
				bookings: [
					{
						hostId: 'host-1',
						// No eventTypeId
						start: d('2024-01-01T10:00:00Z'),
						end: d('2024-01-01T10:30:00Z'),
					},
				],
				range: {
					start: d('2024-01-01T09:00:00Z'),
					end: d('2024-01-01T12:00:00Z'),
				},
				eventTypes: {
					initial_visit: {
						bufferBefore: 0,
						bufferAfter: minutes(15),
					},
				},
			};

			const slots = getAvailableSlots(input, testNow);
			const startTimes = slots.map((s) => s.start.toISOString());

			// Booking without eventTypeId: busy interval is just [10:00, 10:30) with no buffers
			// Free intervals: [09:00, 10:00) and [10:30, 12:00)

			// Candidate slot at 9:30: inflated [9:30, 10:05) does NOT fit in [09:00, 10:00)
			expect(startTimes).not.toContain('2024-01-01T09:30:00.000Z');

			// But slot at 10:30 is available (its inflated [10:30, 11:05) fits in [10:30, 12:00))
			expect(startTimes).toContain('2024-01-01T10:30:00.000Z');
		});

		test('candidate slot buffers must fit in free space', () => {
			// Test that candidate slot's inflated interval must fit within free space
			// Schedule: 09:00-10:00
			// No bookings, but queried event has large buffers
			const eventTypeWithLargeBuffers: EventType = {
				id: 'large-buffer-event',
				length: minutes(30),
				bufferBefore: minutes(15),
				bufferAfter: minutes(15),
			};

			const narrowScheduleHost: HostSchedules = {
				hostId: 'host-1',
				schedules: {
					default: {
						id: 'default',
						rules: [
							{
								days: ['monday'],
								startTime: '09:00',
								endTime: '10:00',
								timezone: 'UTC',
							},
						],
					},
				},
			};

			const input: GetAvailableSlotsInput = {
				eventType: eventTypeWithLargeBuffers,
				hosts: [narrowScheduleHost],
				bookings: [],
				range: {
					start: d('2024-01-01T09:00:00Z'),
					end: d('2024-01-01T10:00:00Z'),
				},
			};

			const slots = getAvailableSlots(input, testNow);
			const startTimes = slots.map((s) => s.start.toISOString());

			// Free interval: [09:00, 10:00)
			// For a slot at time T, inflated interval is [T-15min, T+30min+15min]
			// Slot at 09:15: inflated [09:00, 10:00) - exactly fits!
			// Slot at 09:00: inflated [08:45, 09:45) - bufferBefore extends before 09:00, doesn't fit
			// Slot at 09:30: inflated [09:15, 10:15) - bufferAfter extends past 10:00, doesn't fit

			expect(startTimes).toHaveLength(1);
			expect(startTimes).toEqual(['2024-01-01T09:15:00.000Z']);
		});
	});
});
