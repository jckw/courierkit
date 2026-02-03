import { describe, expect, test } from 'bun:test';
import { intersectIntervals, mergeIntervals, subtractIntervals } from '../src/intervals.js';

const d = (iso: string) => new Date(iso);

describe('mergeIntervals', () => {
	test('returns empty array for empty input', () => {
		expect(mergeIntervals([])).toEqual([]);
	});

	test('returns single interval unchanged', () => {
		const intervals = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(mergeIntervals(intervals)).toEqual(intervals);
	});

	test('merges overlapping intervals', () => {
		const intervals = [
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') },
			{ start: d('2024-01-01T11:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		];
		expect(mergeIntervals(intervals)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		]);
	});

	test('merges adjacent intervals (touching endpoints)', () => {
		const intervals = [
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') },
			{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		];
		expect(mergeIntervals(intervals)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		]);
	});

	test('keeps non-overlapping intervals separate', () => {
		const intervals = [
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T10:00:00Z') },
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T15:00:00Z') },
		];
		expect(mergeIntervals(intervals)).toEqual(intervals);
	});

	test('handles unsorted input', () => {
		const intervals = [
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T16:00:00Z') },
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T11:00:00Z') },
		];
		expect(mergeIntervals(intervals)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T11:00:00Z') },
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T16:00:00Z') },
		]);
	});

	test('merges multiple overlapping intervals', () => {
		const intervals = [
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T11:00:00Z') },
			{ start: d('2024-01-01T10:00:00Z'), end: d('2024-01-01T13:00:00Z') },
			{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T15:00:00Z') },
		];
		expect(mergeIntervals(intervals)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T15:00:00Z') },
		]);
	});
});

describe('subtractIntervals', () => {
	test('returns from intervals when subtract is empty', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(subtractIntervals(from, [])).toEqual(from);
	});

	test('returns empty when from is empty', () => {
		const subtract = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(subtractIntervals([], subtract)).toEqual([]);
	});

	test('removes entire interval when fully covered', () => {
		const from = [{ start: d('2024-01-01T10:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual([]);
	});

	test('trims start of interval', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual([
			{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T17:00:00Z') },
		]);
	});

	test('trims end of interval', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		]);
	});

	test('punches hole in middle of interval', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T13:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') },
			{ start: d('2024-01-01T13:00:00Z'), end: d('2024-01-01T17:00:00Z') },
		]);
	});

	test('handles multiple subtractions from single interval', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		const subtract = [
			{ start: d('2024-01-01T10:00:00Z'), end: d('2024-01-01T11:00:00Z') },
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T15:00:00Z') },
		];
		expect(subtractIntervals(from, subtract)).toEqual([
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T10:00:00Z') },
			{ start: d('2024-01-01T11:00:00Z'), end: d('2024-01-01T14:00:00Z') },
			{ start: d('2024-01-01T15:00:00Z'), end: d('2024-01-01T17:00:00Z') },
		]);
	});

	test('handles non-overlapping subtraction (no effect)', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T15:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual(from);
	});

	test('intervals touching at endpoint are not affected (half-open)', () => {
		const from = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		const subtract = [{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T15:00:00Z') }];
		expect(subtractIntervals(from, subtract)).toEqual(from);
	});
});

describe('intersectIntervals', () => {
	test('returns empty when either input is empty', () => {
		const intervals = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(intersectIntervals([], intervals)).toEqual([]);
		expect(intersectIntervals(intervals, [])).toEqual([]);
	});

	test('returns overlap of two overlapping intervals', () => {
		const a = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T14:00:00Z') }];
		const b = [{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(intersectIntervals(a, b)).toEqual([
			{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		]);
	});

	test('returns empty for non-overlapping intervals', () => {
		const a = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		const b = [{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(intersectIntervals(a, b)).toEqual([]);
	});

	test('intervals touching at endpoint have empty intersection (half-open)', () => {
		const a = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') }];
		const b = [{ start: d('2024-01-01T12:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		expect(intersectIntervals(a, b)).toEqual([]);
	});

	test('returns contained interval when one is inside the other', () => {
		const a = [{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T17:00:00Z') }];
		const b = [{ start: d('2024-01-01T11:00:00Z'), end: d('2024-01-01T14:00:00Z') }];
		expect(intersectIntervals(a, b)).toEqual([
			{ start: d('2024-01-01T11:00:00Z'), end: d('2024-01-01T14:00:00Z') },
		]);
	});

	test('handles multiple intervals in both arrays', () => {
		const a = [
			{ start: d('2024-01-01T09:00:00Z'), end: d('2024-01-01T12:00:00Z') },
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T17:00:00Z') },
		];
		const b = [{ start: d('2024-01-01T10:00:00Z'), end: d('2024-01-01T15:00:00Z') }];
		expect(intersectIntervals(a, b)).toEqual([
			{ start: d('2024-01-01T10:00:00Z'), end: d('2024-01-01T12:00:00Z') },
			{ start: d('2024-01-01T14:00:00Z'), end: d('2024-01-01T15:00:00Z') },
		]);
	});
});
