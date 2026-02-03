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
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T10:30:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T11:00:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Cannot book 9:30-10:00 because buffer before 10:00 booking needs 9:45-10:00
		// So only 9:00-9:30 available before the booking
		const startTimes = slots.map((s) => s.start.toISOString());
		expect(startTimes).toContain('2024-01-01T09:00:00.000Z');
		expect(startTimes).not.toContain('2024-01-01T09:30:00.000Z');
		expect(startTimes).toContain('2024-01-01T10:30:00.000Z');
	});

	test('respects bufferAfter', () => {
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
					start: d('2024-01-01T10:00:00Z'),
					end: d('2024-01-01T10:30:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T11:30:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Cannot book 10:30-11:00 because buffer after 10:30 booking needs 10:30-10:45
		const startTimes = slots.map((s) => s.start.toISOString());
		expect(startTimes).not.toContain('2024-01-01T10:30:00.000Z');
		expect(startTimes).toContain('2024-01-01T10:45:00.000Z');
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
		// Use 15-minute slots to better test the buffer differences
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
							endTime: '10:30',
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
					start: d('2024-01-01T09:30:00Z'),
					end: d('2024-01-01T09:45:00Z'),
				},
				{
					hostId: 'host-2',
					start: d('2024-01-01T09:30:00Z'),
					end: d('2024-01-01T09:45:00Z'),
				},
			],
			range: {
				start: d('2024-01-01T09:00:00Z'),
				end: d('2024-01-01T10:30:00Z'),
			},
		};

		const slots = getAvailableSlots(input, testNow);

		// Host 1 has 30min buffer after, so 9:45-10:15 is blocked (booking ends 9:45 + 30min buffer)
		// Host 2 has 5min buffer after, so 9:45-9:50 is blocked, slots resume at 9:50
		const host1Slots = slots.filter((s) => s.hostId === 'host-1');
		const host2Slots = slots.filter((s) => s.hostId === 'host-2');

		// Host 1: slots at 9:00, 9:15 before booking, then 10:15 after buffer
		expect(host1Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T09:00:00.000Z');
		expect(host1Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T09:15:00.000Z');
		expect(host1Slots.map((s) => s.start.toISOString())).toContain('2024-01-01T10:15:00.000Z');
		expect(host1Slots.map((s) => s.start.toISOString())).not.toContain('2024-01-01T10:00:00.000Z');

		// Host 2: has slot at 9:50 (after shorter buffer)
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

		expect(slots[0].bufferBefore).toEqual({
			start: d('2024-01-01T08:50:00Z'),
			end: d('2024-01-01T09:00:00Z'),
		});
		expect(slots[0].bufferAfter).toEqual({
			start: d('2024-01-01T09:30:00Z'),
			end: d('2024-01-01T09:45:00Z'),
		});
	});
});
