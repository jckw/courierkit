# @courierkit/entitlements

A stateless, composable policy decision library for TypeScript. Given facts about actors, resources, and constraints, it answers the question: **"Is this allowed, and why?"**

## Installation

```bash
npm install @courierkit/entitlements
```

## Quick Start

```typescript
import { createEntitlements, windows } from '@courierkit/entitlements';

// Create an entitlements engine with your adapter
const entitlements = createEntitlements({
  adapter: {
    async getEntitlements(actorId) {
      // Load from your database, Stripe, etc.
      return {
        'api-calls': { limit: 1000, window: windows.monthly },
        'exports': { limit: 10, window: windows.daily },
        'premium-features': { limit: null, window: null }, // unlimited
      };
    },
    async getUsage(actorId, action, interval) {
      // Query your usage/events table
      return db.countUsage(actorId, action, interval);
    },
  },
});

// Check if an action is allowed
const decision = await entitlements.check({
  actorId: 'user-123',
  action: 'api-calls',
  at: new Date(), // optional override for "now"
});

if (decision.outcome.allowed) {
  // Perform the action
  // Then fulfill obligations (e.g., increment usage counter)
  for (const obligation of decision.obligations) {
    if (obligation.type === 'consume') {
      await db.incrementUsage(actorId, action, obligation.params.amount);
    }
  }
}
```

## How It Works

Everything is a decision over facts. The engine layers evaluations to produce a structured outcome:

```
Facts (loaded from your data)        { user, plan, usage, overrides }
→ Rules (pure predicates)            has-feature? within-limit? not-suspended?
→ Results (per-rule)                 allow | deny | skip, with explanation
→ Decision (resolved)                { outcome, reasons[], obligations[] }
```

## Key Features

- **Stateless**: No side effects, no caching, no persistence. You own your data.
- **Explainable**: Every decision includes the full chain of reasoning.
- **Obligations**: The engine tells you what should happen; you decide how to do it.
- **Schema-Agnostic**: Works with any data model via adapters.
- **Type-Safe**: Full TypeScript support with comprehensive type definitions.

## Core Concepts

### Entitlements

Define what actors can do with limits and time windows:

```typescript
import type { Entitlement } from '@courierkit/entitlements';

const entitlement: Entitlement = {
  limit: 100,                              // null = unlimited
  window: { type: 'calendar', unit: 'month' },  // null = lifetime
};
```

### Time Windows

Built-in presets for common patterns:

```typescript
import { windows } from '@courierkit/entitlements';

windows.hourly   // Resets at the start of each hour
windows.daily    // Resets at midnight
windows.weekly   // Resets on Monday
windows.monthly  // Resets on the 1st
windows.yearly   // Resets on Jan 1
windows.lifetime // Never resets

windows.rolling(24, 'hours')  // 24-hour sliding window
windows.rolling(7, 'days')    // 7-day sliding window
```

### Decisions

Every check returns a decision with full context:

```typescript
const decision = await entitlements.check({
  actorId: 'user-123',
  action: 'api-calls',
});

// decision.outcome: { allowed: boolean }
// decision.reasons: [{ rule, outcome, explanation }]
// decision.obligations: [{ type: 'consume', params: { amount: 1 } }]
// decision.trace: { evaluatedAt, durationMs, facts }
```

### Obligations

Obligations are declarative instructions returned with allow decisions:

```typescript
// Common obligation types
{ type: 'consume', params: { amount: 1 } }      // Decrement quota
{ type: 'log', params: { event: 'feature-used' } }  // Audit log
{ type: 'notify', params: { channel: 'slack' } }    // Alert
```

The engine doesn't execute obligations—you decide how to fulfill them.

## High-Level Queries

All engine methods accept an optional `at: Date` override to control evaluation time.

### check

Can this actor do this action?

```typescript
const decision = await entitlements.check({
  actorId: 'user-123',
  action: 'api-calls',
  consume: 1,  // Optional: amount to consume (default 1)
});
```

### capabilities

What can this actor do across multiple actions?

```typescript
const caps = await entitlements.capabilities({
  actorId: 'user-123',
  actions: ['api-calls', 'exports', 'bulk-import'],
});

// caps.actions['api-calls'].status: 'available' | 'exhausted' | 'unavailable'
// caps.summary: { available: [...], exhausted: [...], unavailable: [...] }
```

### availableAt

When can this actor do this action again?

```typescript
const availability = await entitlements.availableAt({
  actorId: 'user-123',
  action: 'exports',
});

// { status: 'now' }
// { status: 'at', at: Date, reason: 'Limit resets at...' }
// { status: 'never', reason: 'Lifetime limit reached' }
```

### remainingUses

How many times can this actor do this action?

```typescript
const remaining = await entitlements.remainingUses({
  actorId: 'user-123',
  action: 'api-calls',
});

// { uses: 750, limitedBy: 'api-calls' }
// { uses: null, limitedBy: null }  // unlimited
```

### dashboard

All quota states for an actor (for UI display):

```typescript
const dash = await entitlements.dashboard({
  actorId: 'user-123',
});

// dash.quotas['api-calls']: {
//   name: 'api-calls',
//   limit: 1000,
//   used: 250,
//   remaining: 750,
//   window: { type: 'calendar', unit: 'month' },
//   resetsAt: Date,
//   interval: { start: Date, end: Date },
// }
```

## Low-Level API

### Limit Checking

```typescript
import { checkLimit, availableAt } from '@courierkit/entitlements';

const result = checkLimit({ limit: 100, used: 95, consume: 1 });
// { allowed: true, remaining: 4, obligation: { type: 'consume', ... } }

const availability = availableAt({
  limit: 100,
  used: 100,
  window: windows.monthly,
});
// { status: 'at', at: Date, reason: '...' }
```

### Time Operations

```typescript
import { resolveWindow, nextReset, describeWindow } from '@courierkit/entitlements';

const interval = resolveWindow(windows.monthly, new Date());
// { start: Date, end: Date }  // Current month boundaries

const reset = nextReset(windows.daily, new Date());
// Date  // Tomorrow at midnight

const description = describeWindow(windows.rolling(24, 'hours'));
// '24 hours rolling window'
```

### Custom Policies

For advanced use cases, build custom policies with the low-level API:

```typescript
import { createPolicy, createRule, evaluate, allow, deny, skip } from '@courierkit/entitlements';

const policy = createPolicy({
  facts: {
    user: { name: 'user', load: (input) => db.getUser(input.userId) },
    plan: {
      name: 'plan',
      depends: ['user'],
      load: (_, facts) => db.getPlan(facts.user.planId),
    },
  },
  rules: [
    createRule({
      id: 'active-subscription',
      description: 'User must have active subscription',
      evaluate: (facts) =>
        facts.plan.active ? allow('Subscription active') : deny('Subscription expired'),
    }),
    createRule({
      id: 'feature-enabled',
      description: 'Feature must be enabled for plan',
      evaluate: (facts, input) =>
        facts.plan.features.includes(input.feature)
          ? allow('Feature enabled')
          : deny('Feature not in plan'),
    }),
  ],
  resolve: (results) => ({
    allowed: results.every(r => r.outcome !== 'deny'),
  }),
});

const decision = await evaluate(policy, { userId: '123', feature: 'export' });
```

## Adapter Interface

```typescript
interface Adapter {
  getEntitlements(actorId: string): Promise<Record<string, Entitlement>>;
  getUsage(actorId: string, action: string, interval: Interval): Promise<number>;
}
```

**getEntitlements** returns a map from action names to entitlement config. Query your schema (plans, features, bundles) and return this shape.

**getUsage** returns the count of times the action was performed within the interval. Query your usage/events table.

## Database Setup

At minimum, you'll want:

- A table/collection for plans or entitlements (action, limit, window)
- A mapping from actors to plans (subscriptions)
- A usage/events table with timestamps and counts

For a concrete schema and query patterns, see the data model guide in the docs.

## Documentation

Full documentation with examples: [courierkit.mintlify.app](https://courierkit.mintlify.app)

## License

MIT
