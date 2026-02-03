# Slot Engine

A stateless, composable slot generation library for Node.js. Given schedules, bookings, external calendar events, and event type configuration, it answers the question: **"When can this happen?"**

---

## 1. Mental Model

Everything is an interval on a timeline. The engine layers intervals on top of each other to produce available slots:

```
Availability (schedule)          ████████████████████████████
− Bookings                          ████       ████
− External calendar blocks               ███
− Buffer zones (derived)            ▒█████▒    ▒████▒
− Minimum notice window          ███
= Available slots                         ░░░░        ░░░░░░░
```

The consumer is responsible for fetching data from their own sources (database, Google Calendar, etc.) and passing it in. The engine never touches a network or database.

---

## 2. Core Concepts

### 2.1 Time Intervals

The universal primitive. Every piece of data entering the engine is normalized into one or more intervals:

```
Interval { start: DateTime, end: DateTime }
```

All intervals are half-open: `[start, end)`. All times are UTC internally; timezone handling is the consumer's responsibility at the input/output boundary.

### 2.2 Hosts

A host is anyone who can be booked. A host is identified by an opaque string ID. The engine has no opinion about what a host is — a clinician, a room, a piece of equipment.

### 2.3 Schedules

A schedule defines recurring windows of base availability for a host.

```
Schedule {
  id: string
  rules: ScheduleRule[]
  overrides?: ScheduleOverride[]
}
```

A **ScheduleRule** defines a recurring pattern of availability:

```
ScheduleRule {
  days: DayOfWeek[]        // e.g. ["monday", "tuesday", "wednesday"]
  startTime: LocalTime     // e.g. "09:00"
  endTime: LocalTime       // e.g. "17:00"
  timezone: string         // IANA timezone, e.g. "America/New_York"
  effectiveFrom?: Date     // optional; when this rule takes effect
  effectiveUntil?: Date    // optional; when this rule expires
}
```

A **ScheduleOverride** punches a hole in (or adds to) normal availability for a specific date range — e.g. "off Dec 23–Jan 2" or "also available Saturday Jan 18."

```
ScheduleOverride {
  date: Date               // the specific date
  available: boolean       // true = add availability, false = remove it
  startTime?: LocalTime    // optional; defaults to full day
  endTime?: LocalTime
}
```

A host has one or more named schedules:

```
HostSchedules {
  hostId: string
  schedules: Record<string, Schedule>   // e.g. { "default": ..., "telehealth": ... }
}
```

### 2.4 Event Types

An event type is the thing being booked. It carries scheduling constraints:

```
EventType {
  id: string
  length: Duration                  // e.g. 30 minutes
  scheduleKey?: string              // which host schedule to use; defaults to "default"

  // Buffers
  bufferBefore?: Duration           // blocked time before the slot
  bufferAfter?: Duration            // blocked time after the slot

  // Constraints
  slotInterval?: Duration           // snap slots to this grid; defaults to length
  minimumNotice?: Duration          // how far in advance the slot must be
  maximumLeadTime?: Duration        // how far into the future slots are offered
  maxPerDay?: number                // max bookings of this type per host per day
  maxPerWeek?: number               // max bookings of this type per host per week

  // Host-level overrides (optional)
  hostOverrides?: Record<HostId, Partial<EventType>>
}
```

`hostOverrides` allows per-host customisation without duplicating the entire event type. For example, a particular clinician might need a longer buffer or have a lower daily cap.

The resolved config for a (host, event type) pair is the event type config merged with any host override, with the override winning.

### 2.5 Bookings & Blocks

Existing commitments that consume a host's time. Both are provided as flat arrays of intervals with metadata:

```
Booking {
  id?: string
  hostId: string
  start: DateTime
  end: DateTime
  eventTypeId?: string        // useful for maxPerDay/maxPerWeek counting
}
```

A **Block** is any external calendar event or manually defined busy period. It has the same shape but no event type:

```
Block {
  hostId: string
  start: DateTime
  end: DateTime
}
```

The engine treats bookings and blocks identically when subtracting from availability — the only difference is that bookings carry an `eventTypeId` for constraint counting.

---

## 3. Query Interface

### 3.1 `getAvailableSlots`

The primary query. Returns a flat list of bookable slots.

**Input:**

```
GetAvailableSlotsInput {
  eventType: EventType
  hosts: HostSchedules[]              // one or more hosts
  bookings: Booking[]                 // existing bookings across all hosts
  blocks?: Block[]                    // external calendar blocks
  range: { start: DateTime, end: DateTime }
}
```

**Output:**

```
Slot {
  hostId: string
  start: DateTime
  end: DateTime                       // = start + eventType.length
  bufferBefore?: Interval             // the actual buffer window (informational)
  bufferAfter?: Interval
}
```

Returns `Slot[]`, sorted by `start` then `hostId`.

### 3.2 Computation Steps

For each host, the engine:

1. **Expand schedule** — Convert the host's relevant schedule (per `eventType.scheduleKey`) into concrete availability intervals within the query range, applying overrides.
2. **Subtract busy intervals** — Remove all bookings and blocks. When subtracting bookings, inflate them by `bufferBefore` / `bufferAfter` so the buffer zones are respected.
3. **Apply minimum notice** — Remove any interval that starts before `now + minimumNotice`.
4. **Apply maximum lead time** — Clamp the query range to `now + maximumLeadTime` if set.
5. **Generate candidate slots** — Walk the remaining free intervals, placing candidate slots at every `slotInterval` step where a full `eventType.length` fits.
6. **Apply daily/weekly caps** — Count existing bookings of this event type per host per day/week. Exclude candidate slots on days/weeks that are already at the cap.
7. **Collect** — Merge results across hosts into a flat list.

### 3.3 Grouping (Future)

The initial output is a flat sorted array. A future version may support grouping options:

- **By host** — `Record<HostId, Slot[]>`
- **By date** — `Record<DateString, Slot[]>`
- **First available per host** — useful for "next available" UI patterns

These can be added as either a query option or standalone utility functions that transform `Slot[]`.

---

## 4. Helpers

### 4.1 `expandRecurrence`

Expands an RRULE (or simplified recurrence definition) into concrete intervals within a date range. Useful for consumers who have recurring events not already expanded by their calendar provider.

```
expandRecurrence(rule: RecurrenceRule, range: DateRange): Interval[]
```

Supports at minimum: daily, weekly, biweekly, monthly recurrence with optional `until` / `count` bounds and exclusion dates.

### 4.2 `buildBlocksFromFreebusy`

Convenience adapter: takes the shape returned by Google Calendar's FreeBusy API (or a compatible format) and returns `Block[]` ready for the engine.

```
buildBlocksFromFreebusy(freebusy: FreeBusyResponse, hostId: string): Block[]
```

### 4.3 `mergeIntervals` / `subtractIntervals`

Low-level interval arithmetic exposed for consumers who want to compose their own logic:

```
mergeIntervals(intervals: Interval[]): Interval[]
subtractIntervals(from: Interval[], subtract: Interval[]): Interval[]
intersectIntervals(a: Interval[], b: Interval[]): Interval[]
```

These are the building blocks of the engine itself.

---

## 5. Design Principles

**Stateless.** No side effects, no caching, no persistence. The consumer owns their data.

**Precomputable.** For consumers running the same query shape repeatedly (e.g. a booking page that rechecks availability), the engine may expose a `prepare` step that builds internal data structures (interval trees, schedule expansions) from the inputs, returning a lightweight query object that can be called multiple times against different ranges or event types without re-processing the same bookings. This is an optimisation, not a requirement — the single-call `getAvailableSlots` must always work.

**Timezone-aware, UTC-native.** Schedules are defined in local time (because "9am–5pm Eastern" is the natural unit). Everything else is UTC. The engine handles the conversion internally using IANA timezone identifiers.

**Extensible via composition.** The engine does not try to model every possible constraint internally. Instead, it exposes its intermediate results and low-level operations so consumers can:

- Add custom filters on the candidate slot list (e.g. "no slots during lunch for this particular host on Wednesdays")
- Implement composite host logic (all-must-be-free) by intersecting per-host results
- Plug in custom recurrence expansion or block sources

**No opinions about IDs, persistence, or transport.** Host IDs, event type IDs, and booking IDs are opaque strings. The engine doesn't validate them, join across them, or assume anything about where they came from.

---

## 6. Scope

### In scope for v1

- Schedule expansion with overrides
- Booking and block subtraction with buffer inflation
- Slot generation with configurable interval grid
- Minimum notice and maximum lead time
- Per-day and per-week caps
- Host-level event type overrides
- Multi-host "any available" queries
- Recurrence expansion helper
- Freebusy adapter helper
- Exposed interval arithmetic

### Deferred

- Composite host queries ("all must be free")
- Grouped output modes
- Round-robin or load-balanced host assignment
- Weighted preferences ("prefer host X")
- Linked / dependent bookings ("book A then B with 1 week gap")
- Calendar write-back
- Caching or incremental recomputation
- Seats / group events (multiple attendees per slot)
