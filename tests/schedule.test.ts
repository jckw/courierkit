import { describe, expect, test } from 'bun:test';
import { expandSchedule } from '../src/schedule.js';
import type { DateRange, Schedule } from '../src/types.js';

const d = (iso: string) => new Date(iso);

describe('expandSchedule', () => {
	test('expands simple weekly schedule', () => {
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
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'), // Monday
			end: d('2024-01-08T00:00:00Z'), // Following Monday
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(5);
		expect(result[0]).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T17:00:00Z'),
		});
		expect(result[4]).toEqual({
			start: d('2024-01-05T09:00:00Z'),
			end: d('2024-01-05T17:00:00Z'),
		});
	});

	test('handles timezone conversion (America/New_York)', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'America/New_York',
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-08T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(1);
		// In winter, EST is UTC-5
		expect(result[0]).toEqual({
			start: d('2024-01-01T14:00:00Z'), // 9am EST = 2pm UTC
			end: d('2024-01-01T22:00:00Z'), // 5pm EST = 10pm UTC
		});
	});

	test('applies schedule overrides to remove availability', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday', 'tuesday'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'UTC',
				},
			],
			overrides: [
				{
					date: '2024-01-01',
					available: false, // Remove Monday
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-03T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			start: d('2024-01-02T09:00:00Z'),
			end: d('2024-01-02T17:00:00Z'),
		});
	});

	test('applies schedule overrides to add availability', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'UTC',
				},
			],
			overrides: [
				{
					date: '2024-01-06', // Saturday
					available: true,
					startTime: '10:00',
					endTime: '14:00',
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-08T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T17:00:00Z'),
		});
		expect(result[1]).toEqual({
			start: d('2024-01-06T10:00:00Z'),
			end: d('2024-01-06T14:00:00Z'),
		});
	});

	test('respects effectiveFrom and effectiveUntil on rules', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'UTC',
					effectiveFrom: '2024-01-08',
					effectiveUntil: '2024-01-15',
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-22T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			start: d('2024-01-08T09:00:00Z'),
			end: d('2024-01-08T17:00:00Z'),
		});
	});

	test('handles multiple rules with different days', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday', 'wednesday', 'friday'],
					startTime: '09:00',
					endTime: '12:00',
					timezone: 'UTC',
				},
				{
					days: ['tuesday', 'thursday'],
					startTime: '13:00',
					endTime: '17:00',
					timezone: 'UTC',
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-06T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);

		expect(result).toHaveLength(5);
	});

	test('handles empty schedule', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-08T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);
		expect(result).toEqual([]);
	});

	test('returns empty when range is outside all rules effectiveFrom/Until', () => {
		const schedule: Schedule = {
			id: 'default',
			rules: [
				{
					days: ['monday'],
					startTime: '09:00',
					endTime: '17:00',
					timezone: 'UTC',
					effectiveFrom: '2024-02-01',
				},
			],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-31T00:00:00Z'),
		};

		const result = expandSchedule(schedule, range);
		expect(result).toEqual([]);
	});
});
