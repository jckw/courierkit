# @courierkit/availability

A stateless, composable slot generation library for Node.js. Given schedules, bookings, external calendar events, and event type configuration, it answers the question: **"When can this happen?"**

## Installation

```bash
npm install @courierkit/availability
```

## Quick Start

```typescript
import { getAvailableSlots } from '@courierkit/availability';

const slots = getAvailableSlots({
  eventType: {
    id: 'consultation',
    length: 60 * 60 * 1000, // 1 hour
    bufferAfter: 15 * 60 * 1000, // 15 min for notes
    minimumNotice: 24 * 60 * 60 * 1000, // 24 hours advance booking
    maxPerDay: 4,
  },
  hosts: [{
    hostId: 'dr-smith',
    schedules: {
      default: {
        id: 'default',
        rules: [{
          days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          startTime: '09:00',
          endTime: '17:00',
          timezone: 'America/New_York',
        }],
        overrides: [
          { date: '2024-12-25', available: false }, // Holiday
        ],
      },
    },
  }],
  bookings: [
    {
      hostId: 'dr-smith',
      start: new Date('2024-01-15T14:00:00Z'),
      end: new Date('2024-01-15T15:00:00Z'),
      eventTypeId: 'consultation',
    },
  ],
  range: {
    start: new Date('2024-01-15T00:00:00Z'),
    end: new Date('2024-01-22T00:00:00Z'),
  },
});

// Returns: Slot[] sorted by start time
// [{ hostId: 'dr-smith', start: Date, end: Date, bufferAfter?: Interval }, ...]
```

## How It Works

Everything is an interval on a timeline. The engine layers intervals to produce available slots:

```
Availability (schedule)          ████████████████████████████
− Bookings                          ████       ████
− External calendar blocks               ███
− Buffer zones (derived)            ▒█████▒    ▒████▒
− Minimum notice window          ███
= Available slots                         ░░░░        ░░░░░░░
```

## Key Features

- **Stateless**: No side effects, no caching, no persistence. You own your data.
- **Timezone-Aware**: Schedules are defined in local time, everything else is UTC.
- **Composable**: Low-level interval arithmetic exposed for custom logic.
- **Type-Safe**: Full TypeScript support.

## Core Concepts

### Schedules

Define recurring availability with rules and overrides:

```typescript
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
  overrides: [
    { date: '2024-12-25', available: false }, // Christmas off
    { date: '2024-01-20', available: true, startTime: '10:00', endTime: '14:00' }, // Special Saturday
  ],
};
```

### Event Types

Configure what's being booked with constraints:

```typescript
const consultation: EventType = {
  id: 'consultation',
  length: 60 * 60 * 1000, // 1 hour
  bufferBefore: 15 * 60 * 1000, // 15 min prep
  bufferAfter: 15 * 60 * 1000, // 15 min notes
  slotInterval: 30 * 60 * 1000, // 30 min grid
  minimumNotice: 24 * 60 * 60 * 1000, // 24 hours
  maxPerDay: 4,
  maxPerWeek: 15,

  // Per-host customization
  hostOverrides: {
    'dr-jones': { maxPerDay: 3 },
  },
};
```

### Multiple Schedules per Host

```typescript
const drSmith: HostSchedules = {
  hostId: 'dr-smith',
  schedules: {
    default: officeSchedule,
    telehealth: extendedHoursSchedule,
  },
};

// Use scheduleKey to select which schedule
const telehealthVisit: EventType = {
  id: 'telehealth',
  length: 20 * 60 * 1000,
  scheduleKey: 'telehealth', // Uses telehealth schedule
};
```

## Helpers

### Google Calendar Integration

```typescript
import { buildBlocksFromFreebusy } from '@courierkit/availability';

// Convert Google Calendar FreeBusy response to blocks
const blocks = buildBlocksFromFreebusy(freebusyResponse, 'dr-smith');
```

### Recurrence Expansion

```typescript
import { expandRecurrence } from '@courierkit/availability';

const weeklyMeeting = {
  frequency: 'weekly' as const,
  days: ['monday', 'wednesday'] as const,
  startTime: '09:00',
  endTime: '10:00',
  timezone: 'America/New_York',
};

const intervals = expandRecurrence(weeklyMeeting, dateRange);
```

### Interval Arithmetic

```typescript
import { mergeIntervals, subtractIntervals, intersectIntervals } from '@courierkit/availability';

// Merge overlapping intervals
const merged = mergeIntervals(intervals);

// Remove busy time from available time
const free = subtractIntervals(available, busy);

// Find common availability (all must be free)
const overlap = intersectIntervals(aliceAvailability, bobAvailability);
```

## API Reference

### `getAvailableSlots(input, now?)`

The main entry point. Returns available slots for the given configuration.

### `expandSchedule(schedule, range)`

Converts a schedule to UTC intervals for a date range.

### `expandRecurrence(rule, range)`

Expands a recurrence rule into concrete intervals.

### `buildBlocksFromFreebusy(freebusy, hostId)`

Converts Google Calendar FreeBusy response to blocks.

### `mergeIntervals(intervals)`

Combines overlapping or adjacent intervals.

### `subtractIntervals(from, subtract)`

Removes intervals from another set.

### `intersectIntervals(a, b)`

Finds time present in both sets.

## Documentation

Full documentation with examples: [courierkit.mintlify.app](https://courierkit.mintlify.app)

## License

MIT
