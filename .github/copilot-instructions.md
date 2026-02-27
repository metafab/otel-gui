# otel-gui Agent Instructions

A lightweight OpenTelemetry trace viewer built with SvelteKit 5. Port 4318 (OTLP/HTTP standard).

## Build & Dev

```sh
pnpm run dev        # Start on port 4318
pnpm run check      # Type-check before commits
pnpm run test       # Run unit tests (Vitest)
pnpm run test:watch # Tests in watch mode
```

**Required**: `pnpm` (not npm/yarn), `@sveltejs/adapter-node` (persistent in-memory state)

## Architecture

- **Routes**: `/v1/traces` (OTLP receiver), `/api/traces` (frontend API), `/api/service-map` (service graph)
- **Server-only code**: `$lib/server/` — never bundled for client
- **Utilities**: `$lib/utils/` — shared helpers for OTLP data transformation
- **Types**: `$lib/types.ts` — all interfaces (use `import type`)

## OTLP Data Handling

### Critical Patterns

**Timestamps are nanosecond strings** (not numbers):

```typescript
// Use BigInt for arithmetic, convert only after scaling
const durationNs = BigInt(endNano) - BigInt(startNano)
const durationMs = Number(durationNs / 1_000_000n)
```

See [time.ts](src/lib/utils/time.ts) for all time formatting.

**Flatten KeyValue[] to Record<string, any>**:

```typescript
// OTLP: [{ key: "http.method", value: { stringValue: "GET" } }]
// →: { "http.method": "GET" }
```

Use `flattenAttributes()` from [attributes.ts](src/lib/utils/attributes.ts) — handles all 7 AnyValue variants.

**Service name extraction**: Lives in `ResourceSpans.resource.attributes['service.name']`, not in spans. Must propagate during ingestion.

**Scope attributes**: `InstrumentationScope.attributes` are flattened and stored as `scopeAttributes` on each `StoredSpan` (alongside `scopeName` and `scopeVersion`). The span detail sidebar shows them in a collapsible **Scope** section below Attributes.

**Span merging**: Traces arrive incrementally across multiple POST requests. Store merges spans by `traceId`, handles out-of-order root spans. See [traceStore.ts](src/lib/server/traceStore.ts#L40-L125).

## Svelte 5 Runes (Planned)

```typescript
// Client stores (.svelte.ts files)
let traces = $state.raw<TraceListItem[]>([]) // .raw = no deep proxying for large arrays
let selectedId = $state<string | null>(null)
let selected = $derived(traces.find((t) => t.id === selectedId))

$effect(() => {
  // Polling, subscriptions
})
```

**Why `$state.raw`**: Trace lists are large arrays replaced wholesale — avoid deep reactive proxy overhead.

## Testing

**Current status**: 129 unit + integration tests, all passing. Run with `pnpm run test`.

**Test files**:

| File                                                                              | What's covered                                                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [attributes.test.ts](src/lib/utils/attributes.test.ts)                            | All 7 AnyValue variants, null/edge cases                                                                                   |
| [time.test.ts](src/lib/utils/time.test.ts)                                        | Duration formatting, negative/zero, timestamps, relative time                                                              |
| [spans.test.ts](src/lib/utils/spans.test.ts)                                      | Tree building, orphans, circular refs, child sort order                                                                    |
| [traceStore.test.ts](src/lib/server/traceStore.test.ts)                           | Ingestion, span merging, FIFO eviction, subscribe/unsubscribe, `resolveRootSpanName`                                       |
| [integration.test.ts](src/routes/integration.test.ts)                             | Full POST→store→GET round-trip for all route handlers (`/v1/traces`, `/api/traces`, `/api/traces/:id`, `/api/service-map`) |
| [ChevronIcon.test.ts](src/lib/components/ChevronIcon.test.ts)                     | SVG render, rotation transform, size prop, aria-hidden                                                                     |
| [ServiceBadge.test.ts](src/lib/components/ServiceBadge.test.ts)                   | Service name text, element/attribute structure, background color                                                           |
| [AttributeItem.test.ts](src/lib/components/AttributeItem.test.ts)                 | Key/value rendering, all 8 type labels, copy button, truncation, onFullscreen callback                                     |
| [KeyboardShortcutsHelp.test.ts](src/lib/components/KeyboardShortcutsHelp.test.ts) | Shortcuts table, dialog role, close via button/backdrop/Escape key                                                         |

**Fixtures** live in `tests/fixtures/` (simple, multi-service, error, out-of-order batches).

**Tool**: Vitest (`vitest.config.ts`) — uses the SvelteKit Vite plugin so `$lib` aliases resolve correctly. `resolve.conditions: ['browser']` forces Svelte's client bundle for component tests. Component tests use `// @vitest-environment jsdom` inline declarations.

**CI**: [`.github/workflows/ci.yml`](workflows/ci.yml) — runs `pnpm run check` then `pnpm run test` on every push/PR to `main` (Node 20, pnpm 10, `--frozen-lockfile`).

**What's deferred to v2** (see [docs/testing.md](../docs/testing.md)):

- E2E tests (Playwright)

## Code Style

- **Imports**: Use `$lib` alias everywhere (SvelteKit convention)
- **Naming**: PascalCase for types/components, camelCase for functions, SCREAMING_SNAKE_CASE for constants
- **Type imports**: `import type { ... }` for interfaces
- **No external UI libs**: Custom waterfall rendering (Honeycomb-inspired)

## Keyboard Shortcuts Pattern

Global shortcuts use `<svelte:window onkeydown={handleGlobalKeydown} />` in each page. Always guard with `isInputFocused()` from `$lib/utils/keyboard` before acting:

```typescript
if (e.key === '/' && !isInputFocused()) {
  e.preventDefault()
  searchInputEl?.focus()
}
```

Shortcuts implemented:
| Key | Trace list | Trace detail |
|-----|-----------|--------------|
| `/` | Focus search | Focus span search |
| `Esc` | Clear search (if focused) | Clear search or go back |
| `Alt/⌥+⌫` | Clear all traces | — || `m` | Toggle Traces/Map tab | Toggle mini service map || `Enter` / `Shift+Enter` | — | Next / prev match (when search focused) |
| `n` / `Shift+N` | — | Next / prev search match |
| `e` / `Shift+E` | — | Next / prev error span |
| `↑↓←→` / `Enter` | — | Waterfall tree navigation |
| `?` | Toggle shortcuts overlay | Toggle shortcuts overlay |

## Key Constraints

1. **Port 4318 non-negotiable** — OTLP/HTTP standard (zero config for exporters)
2. **adapter-node required** — In-memory `Map` must persist across requests
3. **Protobuf and JSON supported** — Both `application/json` and `application/x-protobuf` content types accepted
4. **No gzip yet** — Request body decompression deferred to v2
5. **Max 1000 traces** — FIFO eviction to prevent memory leaks

## Reference Files

- [traceStore.ts](src/lib/server/traceStore.ts) — Ingestion, span merging, eviction, SSE subscriber notifications, `getServiceMap()`
- [protobuf.ts](src/lib/server/protobuf.ts) — Protobuf decoder for OTLP traces
- [attributes.ts](src/lib/utils/attributes.ts) — OTLP AnyValue extraction
- [time.ts](src/lib/utils/time.ts) — BigInt nanosecond formatting
- [graph.ts](src/lib/utils/graph.ts) — Layered graph layout (Sugiyama-style): layer assignment, barycenter ordering, coordinate assignment, Bézier edge paths
- [keyboard.ts](src/lib/utils/keyboard.ts) — `isInputFocused()` guard for global keyboard shortcuts
- [KeyboardShortcutsHelp.svelte](src/lib/components/KeyboardShortcutsHelp.svelte) — `?` help overlay component
- [ServiceMap.svelte](src/lib/components/ServiceMap.svelte) — SVG service map component (full + mini mode); nodes are service/database/messaging shapes; edges show call count, error rate, p50/p99 latency
- [types.ts](src/lib/types.ts) — Complete OTLP data model + `ServiceMapNode`, `ServiceMapEdge`, `ServiceMapData`
- [stream/+server.ts](src/routes/api/traces/stream/+server.ts) — SSE endpoint (debounced, heartbeat)
- [service-map/+server.ts](src/routes/api/service-map/+server.ts) — `GET /api/service-map?traceId=` endpoint
- [docs/research.md](docs/research.md) — OTLP protocol details, data model, Honeycomb UI reference, gotchas
- [docs/plan.md](docs/plan.md) — Full implementation plan (16 steps), architecture diagram, deferred v2 features
- [docs/testing.md](docs/testing.md) — Testing strategy, priority test cases, sample test data

## Implementation Philosophy

Deliberately minimal: no UI libraries, no OTLP libraries, no database. Clean upgrade path via swappable interfaces (`TraceStore` for future SQLite). Real-time updates use SSE (`GET /api/traces/stream`) — `traceStore.subscribe()` notifies the stream handler, which debounces and pushes `event: traces` to the client.

## Service Map

The service map (`GET /api/service-map?traceId=`) aggregates cross-service relationships from all stored traces (or a single trace when `traceId` is provided).

**Edge detection algorithm** (in `traceStore.getServiceMap()`):

1. **Cross-service parent→child**: if a span's `resource['service.name']` differs from its parent span's, record an edge `parentService → childService`.
2. **External systems**: CLIENT spans (`kind === 3`) with `db.system`, `messaging.system`, `rpc.system`, `peer.service`, or `net.peer.name` attributes generate synthetic external nodes (type `database` / `messaging` / `rpc` / `service`).

**Edge metrics** computed per edge: `callCount`, `errorCount`, `p50Ms`, `p99Ms` (derived from sorted callee span durations in nanoseconds).

**Layout** (`graph.ts`): simplified Sugiyama — topological BFS layer assignment → barycenter ordering within each layer → even coordinate assignment → cubic Bézier edge paths. Constants: `NODE_W=140`, `NODE_H=52`, `LAYER_GAP_X=220`, `NODE_GAP_Y=80`.

**UI integration**:

- Trace list page: **Traces / Service Map** tab switcher (`m` to toggle). Map re-fetches whenever `traceStore.traces.length` changes.
- Trace detail page: collapsible **Service Map** section in the trace-identification area (`m` to toggle). Scoped to the current `traceId`. Only shown when there are >1 node or >0 edges.
