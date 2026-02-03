import { describe, expect, test } from 'bun:test';
import { createAvailability } from '../src/engine.js';
import type { AvailabilityAdapter, EventType, HostSchedules } from '../src/types.js';

const d = (iso: string) => new Date(iso);
const hours = (n: number) => n * 60 * 60 * 1000;

describe('createAvailability', () => {
	test('loads data via adapter and respects at override', async () => {
		const eventType: EventType = {
			id: 'consultation',
			length: hours(1),
			minimumNotice: hours(12),
		};

		const host: HostSchedules = {
			hostId: 'host-1',
			schedules: {
				default: {
					id: 'default',
					rules: [
						{
							days: ['monday'],
							startTime: '09:00',
							endTime: '17:00',
							timezone: 'UTC',
						},
					],
				},
			},
		};

		const adapter: AvailabilityAdapter = {
			async getEventType() {
				return eventType;
			},
			async getHosts() {
				return [host];
			},
			async getBookings() {
				return [];
			},
		};

		const availability = createAvailability({ adapter });
		const slots = await availability.getAvailableSlots({
			eventTypeId: 'consultation',
			range: {
				start: d('2024-01-01T00:00:00Z'),
				end: d('2024-01-02T00:00:00Z'),
			},
			at: d('2024-01-01T00:00:00Z'),
		});

		expect(slots[0].start.toISOString()).toBe('2024-01-01T12:00:00.000Z');
		expect(slots).toHaveLength(5);
	});
});
