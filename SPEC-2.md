# @courierkit/entitlements

A stateless, composable policy decision library for TypeScript. Given facts about actors, resources, and constraints, it answers the question: **"Is this allowed, and why?"**

---

## 1. Mental Model

Everything is a decision over facts. The engine layers evaluations to produce a structured outcome:

```
Facts (loaded from your data)        { user, plan, usage, overrides }
→ Rules (pure predicates)            has-feature? within-limit? not-suspended?
→ Results (per-rule)                 allow | deny | skip, with explanation
→ Decision (resolved)                { outcome, reasons[], obligations[] }
```

The consumer is responsible for loading facts from their own sources (database, Stripe, etc.) and passing them in. The engine never touches a network or database.

---

## 2. Core Concepts

### 2.1 Facts

The universal input. Every piece of data entering the engine is provided as a named, typed fact:

```
Fact { name: string, value: unknown }
```

Facts are loaded before rule evaluation. A fact can depend on other facts — for example, `usage` might depend on `entitlements` to know which time window to query.

The engine does not define what facts look like. A fact could be a user record, a subscription object, a usage count, or any other shape. The consumer's fact loaders produce values; rules consume them.

### 2.2 Rules

A rule is a pure predicate that examines facts and returns a result:

```
Rule {
  id: string
  description: string
  evaluate: (facts, input) → RuleResult
}
```

A **RuleResult** is one of three outcomes:

```
RuleResult =
  | { outcome: 'allow', explanation: string, obligations?: Obligation[] }
  | { outcome: 'deny', explanation: string }
  | { outcome: 'skip', explanation: string }
```

- **allow** — the rule passes; optionally attaches obligations
- **deny** — the rule fails; the explanation says why
- **skip** — the rule does not apply to this input (e.g., no quota configured)

Rules are stateless. They receive facts and input, return a result. No side effects.

### 2.3 Obligations

An obligation is a declarative instruction attached to an allow result:

```
Obligation {
  type: string
  params: Record<string, unknown>
}
```

Obligations are not executed by the engine. They are returned to the caller, who decides how to enforce them. Common obligation types:

- `{ type: 'consume', params: { resource: 'api-calls', amount: 1 } }`
- `{ type: 'log', params: { event: 'feature-used', feature: 'export' } }`
- `{ type: 'notify', params: { channel: 'slack', message: '...' } }`

The engine has no opinion about obligation types. They are opaque to the core.

### 2.4 Decisions

A decision is the resolved output of policy evaluation:

```
Decision {
  outcome: T                           // shape defined by the resolve function
  reasons: Reason[]                    // one per rule evaluated
  obligations: Obligation[]            // collected from all allow results
  trace: {
    evaluatedAt: DateTime
    durationMs: number
    facts: Record<string, unknown>     // snapshot for audit
  }
}
```

A **Reason** captures what happened for a single rule:

```
Reason {
  rule: string                         // rule ID
  outcome: 'allow' | 'deny' | 'skip'
  explanation: string
  metadata?: Record<string, unknown>   // rule-specific debug data
}
```

The `outcome` field of a Decision is generic. For entitlements, it might be `{ allowed: boolean }`. For matching, it might be `{ candidates: [...] }`. The shape is determined by the policy's resolve function.

### 2.5 Policies

A policy combines facts, rules, and a resolution strategy:

```
Policy {
  facts: Record<string, FactDefinition>
  rules: Rule[]
  resolve: (results: RuleResult[], input, facts) → T
}
```

The **resolve** function determines how individual rule results combine into a final outcome. Common strategies:

- **All must allow** — deny if any rule denies (entitlements)
- **Any must allow** — allow if any rule allows (feature flags with OR logic)
- **Weighted scoring** — sum weights from allow results (matching)

The engine evaluates all rules and passes the results to resolve. Short-circuiting (stop on first deny) is an optimisation the consumer can implement in resolve or via evaluation options.

---

## 3. Time Primitives

Many policies involve time — quotas reset, trials expire, windows slide. The engine provides primitives for working with time windows.

### 3.1 Intervals

A half-open interval `[start, end)`:

```
Interval { start: DateTime, end: DateTime }
```

All times are UTC internally. Timezone handling for calendar-based windows uses IANA identifiers.

### 3.2 Window Specifications

A window spec describes how to compute an interval relative to a reference time:

```
WindowSpec =
  | { type: 'calendar', unit: CalendarUnit, timezone?: string }
  | { type: 'sliding', duration: Duration }
  | { type: 'lifetime' }
  | { type: 'fixed', start: DateTime, end: DateTime }
```

**CalendarUnit** is one of: `hour`, `day`, `week`, `month`, `year`.

**Duration** is milliseconds or a structured object:

```
Duration = number | { hours?: number, days?: number, weeks?: number, months?: number }
```

### 3.3 Window Operations

```
resolveWindow(spec: WindowSpec, at?: DateTime): Interval
```

Given a window spec and a reference time (defaults to now), returns the concrete interval.

Examples:
- `{ type: 'calendar', unit: 'month' }` at Jan 15 → `[Jan 1 00:00, Feb 1 00:00)`
- `{ type: 'sliding', duration: { hours: 24 } }` at 3pm → `[yesterday 3pm, today 3pm)`
- `{ type: 'lifetime' }` → `[epoch, far future)`

```
nextReset(spec: WindowSpec, at?: DateTime): DateTime | null
```

Returns when the window next resets, or null for lifetime windows.

```
describeWindow(spec: WindowSpec): string
```

Human-readable description: "resets monthly", "24-hour rolling window", "lifetime".

### 3.4 Window Presets

Convenience constants for common windows:

```
windows.hourly   = { type: 'calendar', unit: 'hour' }
windows.daily    = { type: 'calendar', unit: 'day' }
windows.weekly   = { type: 'calendar', unit: 'week' }
windows.monthly  = { type: 'calendar', unit: 'month' }
windows.yearly   = { type: 'calendar', unit: 'year' }
windows.lifetime = { type: 'lifetime' }

windows.rolling(amount: number, unit: 'hours' | 'days' | 'weeks'): WindowSpec
```

---

## 4. Entitlements

The entitlements module provides helpers for the most common policy pattern: checking whether an actor can perform an action given their plan, usage, and constraints.

### 4.1 Entitlement Shape

The engine does not define your entitlements schema. It expects facts to be loaded into a standard shape for the helpers to consume:

```
Entitlement {
  limit: number | null                 // null = unlimited
  window: WindowSpec | null            // null = no time-based reset (lifetime or unlimited)
}
```

This is the minimal information needed to check a limit. The consumer's fact loader maps their schema (Stripe, database tables, etc.) to this shape.

### 4.2 Usage Shape

```
Usage {
  count: number
  interval: Interval | null            // the window that was counted
}
```

### 4.3 Limit Checking

The core helper for quota evaluation:

```
checkLimit(input: {
  limit: number | null
  used: number
  consume?: number                     // default 1
}): {
  allowed: boolean
  remaining: number | null             // null = unlimited
  obligation?: Obligation              // { type: 'consume', params: { amount } }
}
```

If `limit` is null, always returns allowed with null remaining.

If `used + consume > limit`, returns denied.

Otherwise, returns allowed with an obligation to consume.

### 4.4 Availability

When will an action become available again?

```
availableAt(input: {
  limit: number | null
  used: number
  window: WindowSpec | null
  at?: DateTime
}): Availability

Availability =
  | { status: 'now' }
  | { status: 'at', at: DateTime, reason: string }
  | { status: 'never', reason: string }
  | { status: 'unknown', reason: string }
```

- **now** — limit not reached, action is available
- **at** — limit reached, will reset at the given time
- **never** — lifetime limit reached, will never reset
- **unknown** — cannot determine (e.g., external dependency)

### 4.5 Quota State

A unified view of a quota for display or debugging:

```
QuotaState {
  name: string
  limit: number | null
  used: number
  remaining: number | null
  window: WindowSpec | null
  resetsAt: DateTime | null
  interval: Interval | null
}
```

---

## 5. Query Interface

### 5.1 Policy Evaluation

**Input:**

```
EvaluateInput {
  // Provided by caller
  [key: string]: unknown               // arbitrary input passed to fact loaders and rules
}
```

**Output:**

```
Decision<T> {
  outcome: T
  reasons: Reason[]
  obligations: Obligation[]
  trace: { evaluatedAt, durationMs, facts }
}
```

### 5.2 Evaluation Steps

1. **Load facts** — For each fact definition, call its loader with the input context. Respect dependency ordering. Collect loaded values into a facts object.
2. **Evaluate rules** — For each rule, call evaluate with the facts object and input. Collect results.
3. **Resolve** — Pass all rule results to the resolve function. Produce the final outcome.
4. **Collect obligations** — Gather obligations from all allow results.
5. **Build trace** — Snapshot facts, record timing.
6. **Return decision** — Package outcome, reasons, obligations, and trace.

### 5.3 Entitlement Queries

The entitlements module provides higher-level queries built on policy evaluation.

**check** — Can this actor do this action?

```
check(input: { actorId: string, action: string, consume?: number })
  → Decision<{ allowed: boolean }>
```

**capabilities** — What can this actor do across multiple actions?

```
capabilities(input: { actorId: string, actions: string[] })
  → Capabilities

Capabilities {
  actions: Record<string, ActionCapability>
  summary: { available: string[], exhausted: string[], unavailable: string[] }
}

ActionCapability =
  | { status: 'available', quota: QuotaState | null, obligations: Obligation[] }
  | { status: 'exhausted', reason: string, availableAt: DateTime | null, quota: QuotaState }
  | { status: 'unavailable', reason: string }
```

**availableAt** — When can this actor do this action again?

```
availableAt(input: { actorId: string, action: string })
  → Availability
```

**remainingUses** — How many times can this actor do this action?

```
remainingUses(input: { actorId: string, action: string })
  → { uses: number | null, limitedBy: string | null }
```

**dashboard** — All quota states for an actor (for UI display).

```
dashboard(input: { actorId: string })
  → { quotas: Record<string, QuotaState> }
```

---

## 6. Adapter Interface

The entitlements module can be instantiated with an adapter that maps the consumer's data layer to the standard shapes.

```
Adapter {
  getEntitlements: (actorId: string) → Promise<Record<string, Entitlement>>
  getUsage: (actorId: string, action: string, interval: Interval) → Promise<number>
}
```

**getEntitlements** returns a map from action names to entitlement config. The consumer queries their schema (bundles, plans, features, etc.) and returns this shape.

**getUsage** returns the count of times the action was performed within the interval. The consumer queries their usage/events table.

The adapter is optional. Consumers can also define facts and rules directly for full control.

---

## 7. Design Principles

**Stateless.** No side effects, no caching, no persistence. The consumer owns their data.

**Explainable by default.** Every decision includes the full chain of reasoning: which rules fired, what they examined, why they concluded what they did. No black boxes.

**Obligations, not side effects.** The engine tells you what should happen (`consume 1 credit`); you decide whether and how to do it. This keeps the core pure and testable.

**Schema-agnostic.** The engine does not define how you store users, plans, features, or usage. It provides a standard interface; you provide an adapter.

**Composable.** Complex policies are built by combining simple rules. The engine exposes its primitives (time math, limit checking) for consumers who want to build custom logic.

**TypeScript-native.** Full type inference from fact definitions through rule evaluation to decision output. The types guide correct usage.

---

## 8. Scope

### In scope for v1

**Core:**
- Fact loading with dependency ordering
- Rule evaluation with allow/deny/skip outcomes
- Obligations as declarative instructions
- Decision structure with reasons and trace
- Time primitives: intervals, window specs, resolve/reset operations
- Window presets for common patterns

**Entitlements:**
- Limit checking helper
- Availability computation
- Quota state aggregation
- High-level queries: check, capabilities, availableAt, remainingUses, dashboard
- Adapter interface for schema mapping

### Deferred

- Scopes and hierarchical evaluation (user < team < org)
- Override system (admin grants, temporary allowances)
- Soft limits and warnings (80% threshold alerts)
- Batch evaluation (check many actions in one call)
- Caching and incremental recomputation
- Matching module (resource selection with ranking)
- Scheduling module (slot generation from availability)