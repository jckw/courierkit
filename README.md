# CourierKit

A collection of stateless, composable libraries for building scheduling and entitlement systems.

## Packages

### [@courierkit/core](./packages/core)

Shared time primitives used across CourierKit packages.

### [@courierkit/availability](./packages/availability)

Slot generation library for booking systems. Given schedules, bookings, external calendar events, and event type configuration, it answers: **"When can this happen?"**

```typescript
import { getAvailableSlots } from '@courierkit/availability';

const slots = getAvailableSlots({
  eventType: { id: 'consultation', length: 60 * 60 * 1000 },
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
      },
    },
  }],
  bookings: [],
  range: { start: new Date('2024-01-15'), end: new Date('2024-01-22') },
});
```

### [@courierkit/entitlements](./packages/entitlements)

Policy decision library for quota and access control. Given facts about actors, resources, and constraints, it answers: **"Is this allowed, and why?"**

```typescript
import { createEntitlements, windows } from '@courierkit/entitlements';

const entitlements = createEntitlements({
  adapter: {
    async getEntitlements(actorId) {
      return {
        'api-calls': { limit: 1000, window: windows.monthly },
        'exports': { limit: 10, window: windows.daily },
      };
    },
    async getUsage(actorId, action, interval) {
      return db.countUsage(actorId, action, interval);
    },
  },
});

const decision = await entitlements.check({
  actorId: 'user-123',
  action: 'api-calls',
});
```

## Philosophy

Both libraries share core design principles:

- **Stateless**: No side effects, no caching, no persistence. You own your data.
- **Composable**: Low-level primitives exposed for building custom logic.
- **Explainable**: Full visibility into how decisions are made.
- **Type-Safe**: Comprehensive TypeScript definitions throughout.

## Documentation

Full documentation: [courierkit.mintlify.app](https://courierkit.mintlify.app)

## Development

This is a Yarn workspaces monorepo.

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run tests (requires bun)
yarn test

# Type check
yarn typecheck

# Lint
yarn lint
```

## License

MIT
