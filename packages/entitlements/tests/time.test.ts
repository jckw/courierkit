import { describe, expect, test } from 'bun:test';
import {
	durationToMs,
	resolveWindow,
	nextReset,
	describeWindow,
	windows,
	intervalContains,
	intervalsOverlap,
	intervalDuration,
} from '../src/time.js';
import type { WindowSpec } from '../src/types.js';

describe('Time Primitives', () => {
	describe('durationToMs', () => {
		test('converts number directly', () => {
			expect(durationToMs(1000)).toBe(1000);
		});

		test('converts hours', () => {
			expect(durationToMs({ hours: 1 })).toBe(60 * 60 * 1000);
			expect(durationToMs({ hours: 24 })).toBe(24 * 60 * 60 * 1000);
		});

		test('converts days', () => {
			expect(durationToMs({ days: 1 })).toBe(24 * 60 * 60 * 1000);
			expect(durationToMs({ days: 7 })).toBe(7 * 24 * 60 * 60 * 1000);
		});

		test('converts weeks', () => {
			expect(durationToMs({ weeks: 1 })).toBe(7 * 24 * 60 * 60 * 1000);
			expect(durationToMs({ weeks: 2 })).toBe(14 * 24 * 60 * 60 * 1000);
		});

		test('converts months (as 30 days)', () => {
			expect(durationToMs({ months: 1 })).toBe(30 * 24 * 60 * 60 * 1000);
		});

		test('combines multiple units', () => {
			const duration = { hours: 1, days: 1 };
			expect(durationToMs(duration)).toBe(25 * 60 * 60 * 1000);
		});
	});

	describe('resolveWindow', () => {
		const jan15_3pm = new Date('2024-01-15T15:30:00Z');

		describe('calendar windows', () => {
			test('hour window', () => {
				const spec: WindowSpec = { type: 'calendar', unit: 'hour' };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-15T15:00:00Z'));
				expect(interval.end).toEqual(new Date('2024-01-15T16:00:00Z'));
			});

			test('day window', () => {
				const spec: WindowSpec = { type: 'calendar', unit: 'day' };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-15T00:00:00Z'));
				expect(interval.end).toEqual(new Date('2024-01-16T00:00:00Z'));
			});

			test('week window (Monday start)', () => {
				const spec: WindowSpec = { type: 'calendar', unit: 'week' };
				const interval = resolveWindow(spec, jan15_3pm);

				// Jan 15 2024 is a Monday
				expect(interval.start).toEqual(new Date('2024-01-15T00:00:00Z'));
				expect(interval.end).toEqual(new Date('2024-01-22T00:00:00Z'));
			});

			test('month window', () => {
				const spec: WindowSpec = { type: 'calendar', unit: 'month' };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-01T00:00:00Z'));
				expect(interval.end).toEqual(new Date('2024-02-01T00:00:00Z'));
			});

			test('year window', () => {
				const spec: WindowSpec = { type: 'calendar', unit: 'year' };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-01T00:00:00Z'));
				expect(interval.end).toEqual(new Date('2025-01-01T00:00:00Z'));
			});
		});

		describe('sliding windows', () => {
			test('24 hour sliding window', () => {
				const spec: WindowSpec = { type: 'sliding', duration: { hours: 24 } };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-14T15:30:00Z'));
				expect(interval.end).toEqual(jan15_3pm);
			});

			test('7 day sliding window', () => {
				const spec: WindowSpec = { type: 'sliding', duration: { days: 7 } };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date('2024-01-08T15:30:00Z'));
				expect(interval.end).toEqual(jan15_3pm);
			});
		});

		describe('lifetime window', () => {
			test('returns epoch to far future', () => {
				const spec: WindowSpec = { type: 'lifetime' };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(new Date(0));
				expect(interval.end.getFullYear()).toBe(9999);
			});
		});

		describe('fixed window', () => {
			test('returns the exact dates', () => {
				const start = new Date('2024-01-01T00:00:00Z');
				const end = new Date('2024-01-31T23:59:59Z');
				const spec: WindowSpec = { type: 'fixed', start, end };
				const interval = resolveWindow(spec, jan15_3pm);

				expect(interval.start).toEqual(start);
				expect(interval.end).toEqual(end);
			});
		});
	});

	describe('nextReset', () => {
		const jan15_3pm = new Date('2024-01-15T15:30:00Z');

		test('hourly reset', () => {
			const spec: WindowSpec = { type: 'calendar', unit: 'hour' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2024-01-15T16:00:00Z'));
		});

		test('daily reset', () => {
			const spec: WindowSpec = { type: 'calendar', unit: 'day' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2024-01-16T00:00:00Z'));
		});

		test('weekly reset', () => {
			const spec: WindowSpec = { type: 'calendar', unit: 'week' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2024-01-22T00:00:00Z'));
		});

		test('monthly reset', () => {
			const spec: WindowSpec = { type: 'calendar', unit: 'month' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2024-02-01T00:00:00Z'));
		});

		test('yearly reset', () => {
			const spec: WindowSpec = { type: 'calendar', unit: 'year' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2025-01-01T00:00:00Z'));
		});

		test('sliding window reset is duration from now', () => {
			const spec: WindowSpec = { type: 'sliding', duration: { hours: 24 } };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toEqual(new Date('2024-01-16T15:30:00Z'));
		});

		test('lifetime window returns null', () => {
			const spec: WindowSpec = { type: 'lifetime' };
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toBeNull();
		});

		test('fixed window returns null', () => {
			const spec: WindowSpec = {
				type: 'fixed',
				start: new Date('2024-01-01'),
				end: new Date('2024-01-31'),
			};
			const reset = nextReset(spec, jan15_3pm);

			expect(reset).toBeNull();
		});
	});

	describe('describeWindow', () => {
		test('calendar windows', () => {
			expect(describeWindow({ type: 'calendar', unit: 'hour' })).toBe('resets hourly');
			expect(describeWindow({ type: 'calendar', unit: 'day' })).toBe('resets daily');
			expect(describeWindow({ type: 'calendar', unit: 'week' })).toBe('resets weekly');
			expect(describeWindow({ type: 'calendar', unit: 'month' })).toBe('resets monthly');
			expect(describeWindow({ type: 'calendar', unit: 'year' })).toBe('resets yearly');
		});

		test('sliding windows with number duration', () => {
			const spec: WindowSpec = { type: 'sliding', duration: 24 * 60 * 60 * 1000 };
			expect(describeWindow(spec)).toBe('24-hour rolling window');
		});

		test('sliding windows with object duration', () => {
			expect(describeWindow({ type: 'sliding', duration: { hours: 24 } })).toBe(
				'24 hours rolling window'
			);
			expect(describeWindow({ type: 'sliding', duration: { days: 7 } })).toBe(
				'7 days rolling window'
			);
			expect(describeWindow({ type: 'sliding', duration: { weeks: 2 } })).toBe(
				'2 weeks rolling window'
			);
			expect(describeWindow({ type: 'sliding', duration: { months: 1 } })).toBe(
				'1 month rolling window'
			);
		});

		test('lifetime window', () => {
			expect(describeWindow({ type: 'lifetime' })).toBe('lifetime');
		});

		test('fixed window', () => {
			expect(
				describeWindow({
					type: 'fixed',
					start: new Date('2024-01-01'),
					end: new Date('2024-01-31'),
				})
			).toBe('fixed window');
		});
	});

	describe('window presets', () => {
		test('hourly preset', () => {
			expect(windows.hourly).toEqual({ type: 'calendar', unit: 'hour' });
		});

		test('daily preset', () => {
			expect(windows.daily).toEqual({ type: 'calendar', unit: 'day' });
		});

		test('weekly preset', () => {
			expect(windows.weekly).toEqual({ type: 'calendar', unit: 'week' });
		});

		test('monthly preset', () => {
			expect(windows.monthly).toEqual({ type: 'calendar', unit: 'month' });
		});

		test('yearly preset', () => {
			expect(windows.yearly).toEqual({ type: 'calendar', unit: 'year' });
		});

		test('lifetime preset', () => {
			expect(windows.lifetime).toEqual({ type: 'lifetime' });
		});

		test('rolling factory', () => {
			expect(windows.rolling(24, 'hours')).toEqual({
				type: 'sliding',
				duration: { hours: 24 },
			});
			expect(windows.rolling(7, 'days')).toEqual({
				type: 'sliding',
				duration: { days: 7 },
			});
			expect(windows.rolling(2, 'weeks')).toEqual({
				type: 'sliding',
				duration: { weeks: 2 },
			});
		});
	});

	describe('interval helpers', () => {
		const interval = {
			start: new Date('2024-01-15T00:00:00Z'),
			end: new Date('2024-01-16T00:00:00Z'),
		};

		describe('intervalContains', () => {
			test('contains time within interval', () => {
				expect(intervalContains(interval, new Date('2024-01-15T12:00:00Z'))).toBe(true);
			});

			test('contains start time (inclusive)', () => {
				expect(intervalContains(interval, new Date('2024-01-15T00:00:00Z'))).toBe(true);
			});

			test('excludes end time (half-open)', () => {
				expect(intervalContains(interval, new Date('2024-01-16T00:00:00Z'))).toBe(false);
			});

			test('excludes time before interval', () => {
				expect(intervalContains(interval, new Date('2024-01-14T23:59:59Z'))).toBe(false);
			});

			test('excludes time after interval', () => {
				expect(intervalContains(interval, new Date('2024-01-16T00:00:01Z'))).toBe(false);
			});
		});

		describe('intervalsOverlap', () => {
			test('overlapping intervals', () => {
				const a = { start: new Date('2024-01-15T00:00:00Z'), end: new Date('2024-01-16T00:00:00Z') };
				const b = { start: new Date('2024-01-15T12:00:00Z'), end: new Date('2024-01-16T12:00:00Z') };
				expect(intervalsOverlap(a, b)).toBe(true);
			});

			test('adjacent intervals do not overlap', () => {
				const a = { start: new Date('2024-01-15T00:00:00Z'), end: new Date('2024-01-16T00:00:00Z') };
				const b = { start: new Date('2024-01-16T00:00:00Z'), end: new Date('2024-01-17T00:00:00Z') };
				expect(intervalsOverlap(a, b)).toBe(false);
			});

			test('non-overlapping intervals', () => {
				const a = { start: new Date('2024-01-15T00:00:00Z'), end: new Date('2024-01-16T00:00:00Z') };
				const b = { start: new Date('2024-01-17T00:00:00Z'), end: new Date('2024-01-18T00:00:00Z') };
				expect(intervalsOverlap(a, b)).toBe(false);
			});

			test('one interval contains the other', () => {
				const a = { start: new Date('2024-01-15T00:00:00Z'), end: new Date('2024-01-17T00:00:00Z') };
				const b = { start: new Date('2024-01-15T12:00:00Z'), end: new Date('2024-01-16T12:00:00Z') };
				expect(intervalsOverlap(a, b)).toBe(true);
			});
		});

		describe('intervalDuration', () => {
			test('calculates duration in milliseconds', () => {
				expect(intervalDuration(interval)).toBe(24 * 60 * 60 * 1000);
			});
		});
	});
});
