import { describe, expect, test } from 'bun:test';
import { buildBlocksFromFreebusy, expandRecurrence } from '../src/helpers.js';
import type { DateRange, FreeBusyResponse, RecurrenceRule } from '../src/types.js';

const d = (iso: string) => new Date(iso);

describe('expandRecurrence', () => {
	test('expands daily recurrence', () => {
		const rule: RecurrenceRule = {
			frequency: 'daily',
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-04T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T10:00:00Z'),
		});
		expect(result[2]).toEqual({
			start: d('2024-01-03T09:00:00Z'),
			end: d('2024-01-03T10:00:00Z'),
		});
	});

	test('expands weekly recurrence', () => {
		const rule: RecurrenceRule = {
			frequency: 'weekly',
			days: ['monday', 'wednesday'],
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'), // Monday
			end: d('2024-01-15T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(4); // 2 weeks * 2 days
		expect(result[0]).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T10:00:00Z'),
		});
		expect(result[1]).toEqual({
			start: d('2024-01-03T09:00:00Z'),
			end: d('2024-01-03T10:00:00Z'),
		});
	});

	test('expands biweekly recurrence', () => {
		const rule: RecurrenceRule = {
			frequency: 'biweekly',
			days: ['monday'],
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
			start: d('2024-01-01T00:00:00Z'), // Anchor week
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-22T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(2); // Every other Monday
		expect(result[0]).toEqual({
			start: d('2024-01-01T09:00:00Z'),
			end: d('2024-01-01T10:00:00Z'),
		});
		expect(result[1]).toEqual({
			start: d('2024-01-15T09:00:00Z'),
			end: d('2024-01-15T10:00:00Z'),
		});
	});

	test('expands monthly recurrence', () => {
		const rule: RecurrenceRule = {
			frequency: 'monthly',
			dayOfMonth: 15,
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-04-01T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({
			start: d('2024-01-15T09:00:00Z'),
			end: d('2024-01-15T10:00:00Z'),
		});
		expect(result[1]).toEqual({
			start: d('2024-02-15T09:00:00Z'),
			end: d('2024-02-15T10:00:00Z'),
		});
	});

	test('respects until boundary', () => {
		const rule: RecurrenceRule = {
			frequency: 'daily',
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
			until: d('2024-01-03T00:00:00Z'),
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-10T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(2);
	});

	test('respects count limit', () => {
		const rule: RecurrenceRule = {
			frequency: 'daily',
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
			count: 3,
			start: d('2024-01-01T00:00:00Z'),
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-10T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(3);
	});

	test('excludes specific dates', () => {
		const rule: RecurrenceRule = {
			frequency: 'daily',
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'UTC',
			exclude: [d('2024-01-02T00:00:00Z')],
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-04T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(2);
		expect(result.map((i) => i.start.toISOString())).not.toContain('2024-01-02T09:00:00.000Z');
	});

	test('handles timezone conversion', () => {
		const rule: RecurrenceRule = {
			frequency: 'daily',
			startTime: '09:00',
			endTime: '10:00',
			timezone: 'America/New_York',
		};

		const range: DateRange = {
			start: d('2024-01-01T00:00:00Z'),
			end: d('2024-01-02T00:00:00Z'),
		};

		const result = expandRecurrence(rule, range);

		expect(result).toHaveLength(1);
		// 9am EST = 2pm UTC in winter
		expect(result[0]).toEqual({
			start: d('2024-01-01T14:00:00Z'),
			end: d('2024-01-01T15:00:00Z'),
		});
	});
});

describe('buildBlocksFromFreebusy', () => {
	test('converts Google-style freebusy response', () => {
		const freebusy: FreeBusyResponse = {
			calendars: {
				primary: {
					busy: [
						{ start: '2024-01-01T10:00:00Z', end: '2024-01-01T11:00:00Z' },
						{ start: '2024-01-01T14:00:00Z', end: '2024-01-01T15:00:00Z' },
					],
				},
			},
		};

		const blocks = buildBlocksFromFreebusy(freebusy, 'host-1');

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toEqual({
			hostId: 'host-1',
			start: d('2024-01-01T10:00:00Z'),
			end: d('2024-01-01T11:00:00Z'),
		});
		expect(blocks[1]).toEqual({
			hostId: 'host-1',
			start: d('2024-01-01T14:00:00Z'),
			end: d('2024-01-01T15:00:00Z'),
		});
	});

	test('merges busy times from multiple calendars', () => {
		const freebusy: FreeBusyResponse = {
			calendars: {
				primary: {
					busy: [{ start: '2024-01-01T10:00:00Z', end: '2024-01-01T11:00:00Z' }],
				},
				work: {
					busy: [{ start: '2024-01-01T14:00:00Z', end: '2024-01-01T15:00:00Z' }],
				},
			},
		};

		const blocks = buildBlocksFromFreebusy(freebusy, 'host-1');

		expect(blocks).toHaveLength(2);
	});

	test('handles empty calendars', () => {
		const freebusy: FreeBusyResponse = {
			calendars: {
				primary: {
					busy: [],
				},
			},
		};

		const blocks = buildBlocksFromFreebusy(freebusy, 'host-1');

		expect(blocks).toEqual([]);
	});

	test('handles missing calendars object', () => {
		const freebusy: FreeBusyResponse = {
			calendars: {},
		};

		const blocks = buildBlocksFromFreebusy(freebusy, 'host-1');

		expect(blocks).toEqual([]);
	});
});
