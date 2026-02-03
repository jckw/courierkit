import { describe, expect, test } from 'bun:test';
import { checkLimit, availableAt, remainingQuota } from '../src/limits.js';
import type { WindowSpec } from '../src/types.js';

describe('Limit Checking', () => {
	describe('checkLimit', () => {
		describe('unlimited', () => {
			test('always allowed with null remaining', () => {
				const result = checkLimit({ limit: null, used: 0 });
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBeNull();
				expect(result.obligation).toBeUndefined();
			});

			test('allowed regardless of usage', () => {
				const result = checkLimit({ limit: null, used: 1000000 });
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBeNull();
			});
		});

		describe('within limit', () => {
			test('allowed when under limit', () => {
				const result = checkLimit({ limit: 10, used: 5 });
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBe(4); // 10 - 5 - 1 (default consume)
			});

			test('returns consume obligation', () => {
				const result = checkLimit({ limit: 10, used: 5 });
				expect(result.obligation).toEqual({
					type: 'consume',
					params: { amount: 1 },
				});
			});

			test('allowed at exact limit boundary', () => {
				const result = checkLimit({ limit: 10, used: 9 });
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBe(0);
			});

			test('uses custom consume amount', () => {
				const result = checkLimit({ limit: 10, used: 5, consume: 3 });
				expect(result.allowed).toBe(true);
				expect(result.remaining).toBe(2); // 10 - 5 - 3
				expect(result.obligation?.params.amount).toBe(3);
			});
		});

		describe('over limit', () => {
			test('denied when at limit', () => {
				const result = checkLimit({ limit: 10, used: 10 });
				expect(result.allowed).toBe(false);
				expect(result.remaining).toBe(0);
				expect(result.obligation).toBeUndefined();
			});

			test('denied when over limit', () => {
				const result = checkLimit({ limit: 10, used: 15 });
				expect(result.allowed).toBe(false);
				expect(result.remaining).toBe(0);
			});

			test('denied when consume would exceed', () => {
				const result = checkLimit({ limit: 10, used: 8, consume: 5 });
				expect(result.allowed).toBe(false);
				expect(result.remaining).toBe(2);
			});
		});
	});

	describe('availableAt', () => {
		const now = new Date('2024-01-15T15:30:00Z');

		describe('unlimited', () => {
			test('available now when unlimited', () => {
				const result = availableAt({ limit: null, used: 0, window: null, at: now });
				expect(result.status).toBe('now');
			});
		});

		describe('within limit', () => {
			test('available now when under limit', () => {
				const result = availableAt({
					limit: 10,
					used: 5,
					window: { type: 'calendar', unit: 'day' },
					at: now,
				});
				expect(result.status).toBe('now');
			});
		});

		describe('at limit with window', () => {
			test('returns reset time for calendar window', () => {
				const result = availableAt({
					limit: 10,
					used: 10,
					window: { type: 'calendar', unit: 'day' },
					at: now,
				});

				expect(result.status).toBe('at');
				if (result.status === 'at') {
					expect(result.at).toEqual(new Date('2024-01-16T00:00:00Z'));
				}
			});

			test('returns reset time for monthly window', () => {
				const result = availableAt({
					limit: 100,
					used: 100,
					window: { type: 'calendar', unit: 'month' },
					at: now,
				});

				expect(result.status).toBe('at');
				if (result.status === 'at') {
					expect(result.at).toEqual(new Date('2024-02-01T00:00:00Z'));
				}
			});

			test('returns reset time for sliding window', () => {
				const result = availableAt({
					limit: 10,
					used: 10,
					window: { type: 'sliding', duration: { hours: 24 } },
					at: now,
				});

				expect(result.status).toBe('at');
				if (result.status === 'at') {
					expect(result.at).toEqual(new Date('2024-01-16T15:30:00Z'));
				}
			});
		});

		describe('lifetime limits', () => {
			test('never available for lifetime window at limit', () => {
				const result = availableAt({
					limit: 10,
					used: 10,
					window: { type: 'lifetime' },
					at: now,
				});

				expect(result.status).toBe('never');
				if (result.status === 'never') {
					expect(result.reason).toContain('Lifetime limit reached');
				}
			});

			test('never available for null window at limit', () => {
				const result = availableAt({
					limit: 10,
					used: 10,
					window: null,
					at: now,
				});

				expect(result.status).toBe('never');
			});
		});

		describe('fixed window', () => {
			test('never available for fixed window at limit', () => {
				const result = availableAt({
					limit: 10,
					used: 10,
					window: {
						type: 'fixed',
						start: new Date('2024-01-01'),
						end: new Date('2024-01-31'),
					},
					at: now,
				});

				expect(result.status).toBe('never');
				if (result.status === 'never') {
					expect(result.reason).toContain('Fixed window');
				}
			});
		});
	});

	describe('remainingQuota', () => {
		test('returns null for unlimited', () => {
			expect(remainingQuota(null, 100)).toBeNull();
		});

		test('returns remaining count', () => {
			expect(remainingQuota(10, 3)).toBe(7);
		});

		test('returns 0 when at limit', () => {
			expect(remainingQuota(10, 10)).toBe(0);
		});

		test('returns 0 when over limit (not negative)', () => {
			expect(remainingQuota(10, 15)).toBe(0);
		});
	});
});
