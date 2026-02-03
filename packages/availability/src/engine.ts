/**
 * Availability engine with adapter-based data loading.
 */

import { getAvailableSlots } from './slots.js';
import type {
	AvailabilityAdapter,
	AvailabilityEngine,
	AvailabilityQuery,
	CreateAvailabilityOptions,
	EventType,
	EventTypeBufferConfig,
	HostId,
	Slot,
} from './types.js';

function collectEventTypeIds(bookings: { eventTypeId?: string }[]): string[] {
	const ids = new Set<string>();
	for (const booking of bookings) {
		if (booking.eventTypeId) {
			ids.add(booking.eventTypeId);
		}
	}
	return Array.from(ids);
}

function buildFallbackBuffers(eventType: EventType): Record<string, EventTypeBufferConfig> | undefined {
	if (eventType.bufferBefore === undefined && eventType.bufferAfter === undefined) {
		return undefined;
	}

	return {
		[eventType.id]: {
			bufferBefore: eventType.bufferBefore,
			bufferAfter: eventType.bufferAfter,
		},
	};
}

function normalizeHostIds(hostIds: HostId[] | undefined): HostId[] {
	return hostIds?.filter((id) => id.length > 0) ?? [];
}

/**
 * Create an availability engine with the given adapter.
 */
export function createAvailability(options: CreateAvailabilityOptions): AvailabilityEngine {
	const { adapter } = options;

	async function getAvailableSlotsForQuery(input: AvailabilityQuery): Promise<Slot[]> {
		const { eventTypeId, hostIds, range, at } = input;

		const [eventType, hosts] = await Promise.all([
			adapter.getEventType(eventTypeId),
			adapter.getHosts({ hostIds, eventTypeId }),
		]);

		const resolvedHostIds = normalizeHostIds(hosts.map((host) => host.hostId));
		if (resolvedHostIds.length === 0) {
			return [];
		}

		const [bookings, blocks] = await Promise.all([
			adapter.getBookings({ hostIds: resolvedHostIds, range }),
			adapter.getBlocks ? adapter.getBlocks({ hostIds: resolvedHostIds, range }) : Promise.resolve([]),
		]);

		const bookingEventTypeIds = collectEventTypeIds(bookings);
		let eventTypes: Record<string, EventTypeBufferConfig> | undefined;

		if (adapter.getEventTypeBuffers && bookingEventTypeIds.length > 0) {
			eventTypes = await adapter.getEventTypeBuffers({ eventTypeIds: bookingEventTypeIds });
		}

		const fallbackBuffers = buildFallbackBuffers(eventType);
		if (fallbackBuffers) {
			eventTypes = { ...fallbackBuffers, ...(eventTypes ?? {}) };
		}

		return getAvailableSlots(
			{
				eventType,
				hosts,
				bookings,
				blocks,
				range,
				eventTypes,
			},
			at,
		);
	}

	return {
		getAvailableSlots: getAvailableSlotsForQuery,
	};
}
