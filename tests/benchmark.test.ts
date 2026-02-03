import { describe, expect, test } from 'bun:test';
import { getAvailableSlots } from '../src/slots.js';
import { expandSchedule } from '../src/schedule.js';
import { mergeIntervals, subtractIntervals } from '../src/intervals.js';
import type {
	Booking,
	EventType,
	GetAvailableSlotsInput,
	HostSchedules,
	Schedule,
} from '../src/types.js';

const d = (iso: string) => new Date(iso);
const minutes = (n: number) => n * 60 * 1000;
const hours = (n: number) => n * 60 * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;

// Utility to measure execution time
function measure<T>(fn: () => T): { result: T; durationMs: number } {
	const start = performance.now();
	const result = fn();
	const durationMs = performance.now() - start;
	return { result, durationMs };
}

// Generate random bookings for a host
function generateBookings(
	hostId: string,
	eventTypeId: string,
	startDate: Date,
	count: number
): Booking[] {
	const bookings: Booking[] = [];
	let current = new Date(startDate);

	for (let i = 0; i < count; i++) {
		// Add booking every 2-4 hours randomly
		current = new Date(current.getTime() + (2 + Math.random() * 2) * hours(1));

		// Skip weekends
		while (current.getUTCDay() === 0 || current.getUTCDay() === 6) {
			current = new Date(current.getTime() + days(1));
		}

		// Only book during business hours (9-17)
		const hour = current.getUTCHours();
		if (hour < 9) {
			current.setUTCHours(9, 0, 0, 0);
		} else if (hour >= 17) {
			current = new Date(current.getTime() + days(1));
			current.setUTCHours(9, 0, 0, 0);
		}

		bookings.push({
			id: `booking-${i}`,
			hostId,
			eventTypeId,
			start: new Date(current),
			end: new Date(current.getTime() + minutes(30)),
		});
	}

	return bookings;
}

// Create a standard host schedule
function createHostSchedule(hostId: string): HostSchedules {
	return {
		hostId,
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
}

describe('Benchmark Tests', () => {
	const now = d('2024-01-01T00:00:00Z');

	describe('Schedule Expansion', () => {
		test('expands 1 week schedule', () => {
			const schedule: Schedule = {
				id: 'default',
				rules: [
					{
						days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
						startTime: '09:00',
						endTime: '17:00',
						timezone: 'America/New_York',
					},
				],
			};

			const { result, durationMs } = measure(() =>
				expandSchedule(schedule, {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-01-08T00:00:00Z'),
				})
			);

			console.log(`Schedule expansion (1 week): ${durationMs.toFixed(2)}ms, ${result.length} intervals`);
			expect(result.length).toBe(5); // 5 weekdays
			expect(durationMs).toBeLessThan(100); // Should be fast
		});

		test('expands 1 month schedule', () => {
			const schedule: Schedule = {
				id: 'default',
				rules: [
					{
						days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
						startTime: '09:00',
						endTime: '17:00',
						timezone: 'America/New_York',
					},
				],
			};

			const { result, durationMs } = measure(() =>
				expandSchedule(schedule, {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-02-01T00:00:00Z'),
				})
			);

			console.log(`Schedule expansion (1 month): ${durationMs.toFixed(2)}ms, ${result.length} intervals`);
			expect(result.length).toBeGreaterThan(20);
			expect(durationMs).toBeLessThan(200);
		});

		test('expands 1 year schedule', () => {
			const schedule: Schedule = {
				id: 'default',
				rules: [
					{
						days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
						startTime: '09:00',
						endTime: '17:00',
						timezone: 'America/New_York',
					},
				],
			};

			const { result, durationMs } = measure(() =>
				expandSchedule(schedule, {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2025-01-01T00:00:00Z'),
				})
			);

			console.log(`Schedule expansion (1 year): ${durationMs.toFixed(2)}ms, ${result.length} intervals`);
			expect(result.length).toBeGreaterThan(250);
			expect(durationMs).toBeLessThan(5000);
		});
	});

	describe('Interval Operations', () => {
		test('merges 1000 random intervals', () => {
			const intervals = Array.from({ length: 1000 }, (_, i) => ({
				start: new Date(now.getTime() + Math.random() * days(30)),
				end: new Date(now.getTime() + Math.random() * days(30) + hours(1)),
			}));

			const { result, durationMs } = measure(() => mergeIntervals(intervals));

			console.log(`Merge 1000 intervals: ${durationMs.toFixed(2)}ms, ${result.length} merged intervals`);
			expect(durationMs).toBeLessThan(50);
		});

		test('subtracts 500 intervals from 500 intervals', () => {
			const from = Array.from({ length: 500 }, (_, i) => ({
				start: new Date(now.getTime() + i * hours(2)),
				end: new Date(now.getTime() + i * hours(2) + hours(1)),
			}));

			const subtract = Array.from({ length: 500 }, (_, i) => ({
				start: new Date(now.getTime() + i * hours(2) + minutes(15)),
				end: new Date(now.getTime() + i * hours(2) + minutes(45)),
			}));

			const { result, durationMs } = measure(() => subtractIntervals(from, subtract));

			console.log(`Subtract 500 from 500: ${durationMs.toFixed(2)}ms, ${result.length} result intervals`);
			expect(durationMs).toBeLessThan(500);
		});
	});

	describe('Slot Generation', () => {
		test('single host, no bookings, 1 week', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(30),
			};

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts: [createHostSchedule('host-1')],
				bookings: [],
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-01-08T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`1 host, 0 bookings, 1 week: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(result.length).toBe(80); // 5 days * 16 slots per day
			expect(durationMs).toBeLessThan(100);
		});

		test('single host, 50 bookings, 1 month', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(30),
				bufferBefore: minutes(10),
				bufferAfter: minutes(10),
			};

			const bookings = generateBookings('host-1', 'consultation', now, 50);

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts: [createHostSchedule('host-1')],
				bookings,
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-02-01T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`1 host, 50 bookings, 1 month: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(durationMs).toBeLessThan(200);
		});

		test('10 hosts, no bookings, 1 week', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(30),
			};

			const hosts = Array.from({ length: 10 }, (_, i) => createHostSchedule(`host-${i}`));

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts,
				bookings: [],
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-01-08T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`10 hosts, 0 bookings, 1 week: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(result.length).toBe(800); // 10 hosts * 80 slots
			expect(durationMs).toBeLessThan(500);
		});

		test('10 hosts, 20 bookings each, 1 month', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(30),
				bufferBefore: minutes(15),
				bufferAfter: minutes(15),
				maxPerDay: 8,
			};

			const hosts = Array.from({ length: 10 }, (_, i) => createHostSchedule(`host-${i}`));
			const bookings = hosts.flatMap((host) =>
				generateBookings(host.hostId, 'consultation', now, 20)
			);

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts,
				bookings,
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-02-01T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`10 hosts, 200 bookings, 1 month: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(durationMs).toBeLessThan(10000);
		});

		test('50 hosts, 10 bookings each, 2 weeks', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(60),
				slotInterval: minutes(30),
				minimumNotice: hours(24),
			};

			const hosts = Array.from({ length: 50 }, (_, i) => createHostSchedule(`host-${i}`));
			const bookings = hosts.flatMap((host) =>
				generateBookings(host.hostId, 'consultation', now, 10)
			);

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts,
				bookings,
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-01-15T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`50 hosts, 500 bookings, 2 weeks: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(durationMs).toBeLessThan(5000);
		});
	});

	describe('Complex Scenarios', () => {
		test('schedule with many overrides', () => {
			const schedule: Schedule = {
				id: 'default',
				rules: [
					{
						days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
						startTime: '09:00',
						endTime: '17:00',
						timezone: 'UTC',
					},
				],
				overrides: Array.from({ length: 50 }, (_, i) => ({
					date: new Date(now.getTime() + i * days(1)),
					available: i % 3 !== 0, // Every 3rd day is unavailable
					startTime: i % 2 === 0 ? '10:00' : undefined,
					endTime: i % 2 === 0 ? '16:00' : undefined,
				})),
			};

			const { result, durationMs } = measure(() =>
				expandSchedule(schedule, {
					start: now,
					end: new Date(now.getTime() + days(60)),
				})
			);

			console.log(`Schedule with 50 overrides: ${durationMs.toFixed(2)}ms, ${result.length} intervals`);
			expect(durationMs).toBeLessThan(5000);
		});

		test('host with custom overrides', () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(45),
				bufferBefore: minutes(15),
				bufferAfter: minutes(15),
				maxPerDay: 6,
				maxPerWeek: 25,
				hostOverrides: {
					'host-1': { maxPerDay: 4, bufferAfter: minutes(30) },
					'host-2': { length: minutes(60), maxPerDay: 5 },
					'host-3': { bufferBefore: minutes(30), bufferAfter: minutes(30) },
				},
			};

			const hosts = Array.from({ length: 5 }, (_, i) => createHostSchedule(`host-${i}`));
			const bookings = hosts.flatMap((host) =>
				generateBookings(host.hostId, 'consultation', now, 15)
			);

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts,
				bookings,
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-01-15T00:00:00Z'),
				},
			};

			const { result, durationMs } = measure(() => getAvailableSlots(input, now));

			console.log(`5 hosts with overrides: ${durationMs.toFixed(2)}ms, ${result.length} slots`);
			expect(durationMs).toBeLessThan(500);
		});
	});

	describe('Throughput', () => {
		test('measures slots per second', { timeout: 30000 }, () => {
			const eventType: EventType = {
				id: 'consultation',
				length: minutes(30),
			};

			const input: GetAvailableSlotsInput = {
				eventType,
				hosts: [createHostSchedule('host-1')],
				bookings: [],
				range: {
					start: d('2024-01-01T00:00:00Z'),
					end: d('2024-02-01T00:00:00Z'),
				},
			};

			// Run multiple iterations
			const iterations = 100;
			const start = performance.now();
			let totalSlots = 0;

			for (let i = 0; i < iterations; i++) {
				const slots = getAvailableSlots(input, now);
				totalSlots += slots.length;
			}

			const totalMs = performance.now() - start;
			const slotsPerSecond = (totalSlots / totalMs) * 1000;

			console.log(`Throughput: ${slotsPerSecond.toFixed(0)} slots/second over ${iterations} iterations`);
			console.log(`Average: ${(totalMs / iterations).toFixed(2)}ms per query`);

			expect(slotsPerSecond).toBeGreaterThan(1000);
		});
	});
});
