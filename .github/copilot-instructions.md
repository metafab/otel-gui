# otel-gui Agent Instructions

A lightweight OpenTelemetry trace viewer built with SvelteKit 5. Port 4318 (OTLP/HTTP standard).

## Build & Dev

```sh
pnpm run dev     # Start on port 4318
pnpm run check   # Type-check before commits
pnpm run test    # Run tests (when added - see docs/testing.md)
```

**Required**: `pnpm` (not npm/yarn), `@sveltejs/adapter-node` (persistent in-memory state)

## Architecture

- **Routes**: `/v1/traces` (OTLP receiver), `/api/traces` (frontend API)
- **Server-only code**: `$lib/server/` — never bundled for client
- **Utilities**: `$lib/utils/` — shared helpers for OTLP data transformation
- **Types**: `$lib/types.ts` — all interfaces (use `import type`)

## OTLP Data Handling

### Critical Patterns

**Timestamps are nanosecond strings** (not numbers):

```typescript
// Use BigInt for arithmetic, convert only after scaling
const durationNs = BigInt(endNano) - BigInt(startNano);
const durationMs = Number(durationNs / 1_000_000n);
```

See [time.ts](src/lib/utils/time.ts) for all time formatting.

**Flatten KeyValue[] to Record<string, any>**:

```typescript
// OTLP: [{ key: "http.method", value: { stringValue: "GET" } }]
// →: { "http.method": "GET" }
```

Use `flattenAttributes()` from [attributes.ts](src/lib/utils/attributes.ts) — handles all 7 AnyValue variants.

**Service name extraction**: Lives in `ResourceSpans.resource.attributes['service.name']`, not in spans. Must propagate during ingestion.

**Span merging**: Traces arrive incrementally across multiple POST requests. Store merges spans by `traceId`, handles out-of-order root spans. See [traceStore.ts](src/lib/server/traceStore.ts#L40-L125).

## Svelte 5 Runes (Planned)

```typescript
// Client stores (.svelte.ts files)
let traces = $state.raw<TraceListItem[]>([]); // .raw = no deep proxying for large arrays
let selectedId = $state<string | null>(null);
let selected = $derived(traces.find((t) => t.id === selectedId));

$effect(() => {
  // Polling, subscriptions
});
```

**Why `$state.raw`**: Trace lists are large arrays replaced wholesale — avoid deep reactive proxy overhead.

## Testing

**Current status**: No tests yet. Type checking via `pnpm run check` is primary validation.

**Priority when adding tests** (see [docs/testing.md](../docs/testing.md)):

1. OTLP data transformations (`flattenAttributes`, nanosecond handling)
2. Span tree building (orphan spans, out-of-order roots)
3. TraceStore span merging and eviction
4. UI components deferred to v2

**Tool**: Vitest (Vite-native, fast)

## Code Style

- **Imports**: Use `$lib` alias everywhere (SvelteKit convention)
- **Naming**: PascalCase for types/components, camelCase for functions, SCREAMING_SNAKE_CASE for constants
- **Type imports**: `import type { ... }` for interfaces
- **No external UI libs**: Custom waterfall rendering (Honeycomb-inspired)

## Key Constraints

1. **Port 4318 non-negotiable** — OTLP/HTTP standard (zero config for exporters)
2. **adapter-node required** — In-memory `Map` must persist across requests
3. **Protobuf and JSON supported** — Both `application/json` and `application/x-protobuf` content types accepted
4. **No gzip yet** — Request body decompression deferred to v2
5. **Max 1000 traces** — FIFO eviction to prevent memory leaks

## Reference Files

- [traceStore.ts](src/lib/server/traceStore.ts) — Ingestion, span merging, eviction
- [protobuf.ts](src/lib/server/protobuf.ts) — Protobuf decoder for OTLP traces
- [attributes.ts](src/lib/utils/attributes.ts) — OTLP AnyValue extraction
- [time.ts](src/lib/utils/time.ts) — BigInt nanosecond formatting
- [types.ts](src/lib/types.ts) — Complete OTLP data model
- [docs/research.md](docs/research.md) — OTLP protocol details, data model, Honeycomb UI reference, gotchas
- [docs/plan.md](docs/plan.md) — Full implementation plan (16 steps), architecture diagram, deferred v2 features
- [docs/testing.md](docs/testing.md) — Testing strategy, priority test cases, sample test data

## Implementation Philosophy

Deliberately minimal: no UI libraries, no OTLP libraries, no database. Clean upgrade path via swappable interfaces (`TraceStore` for future SQLite, polling → SSE).
