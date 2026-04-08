# otel-gui Agent Instructions

A lightweight OpenTelemetry trace viewer built with SvelteKit 5. Port 4318 (OTLP/HTTP standard).

## Build & Dev

```sh
pnpm run dev        # Start on port 4318
pnpm run check      # Type-check before commits
pnpm run test       # Run unit tests (Vitest)
pnpm run test:watch # Tests in watch mode
```

## Formatting Workflow

Before submitting changes (including agent-generated edits), run:

```sh
pnpm run format:changed
pnpm run lint:fix
```

Then validate with:

```sh
pnpm run format:check
```

**Required**: `pnpm` (not npm/yarn), Node.js 20+, `@sveltejs/adapter-node` (persistent server process state)

## Architecture

- **Routes**: `/v1/traces` + `/v1/logs` (OTLP receivers), `/api/traces` (list + clear/delete-selected), `/api/traces/:id` (detail), `/api/traces/:id/export` (single export), `/api/traces/export` (bulk export), `/api/traces/import/preview` + `/api/traces/import` (import flow), `/api/service-map` (service graph), `/api/config` (runtime config + persistence status)
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

Use `flattenAttributes()` from `@otel-gui/core` ([packages/core/src/attributes.ts](packages/core/src/attributes.ts)) — handles all 7 AnyValue variants.

**Service name extraction**: Lives in `ResourceSpans.resource.attributes['service.name']`, not in spans. Must propagate during ingestion.

**Scope attributes**: `InstrumentationScope.attributes` are flattened and stored as `scopeAttributes` on each `StoredSpan` (alongside `scopeName` and `scopeVersion`). The span detail sidebar shows them in a collapsible **Scope** section below Attributes.

**Span merging**: Traces arrive incrementally across multiple POST requests. Store merges spans by `traceId`, handles out-of-order root spans. The merge logic lives in [core.ts](src/lib/server/traceStore/core.ts) and is used by swappable backends.

## Optional Persistence (PGlite)

`traceStore` now supports pluggable backends:

- `memory` (default, OSS built-in)
- `pglite` (optional, typically provided by an external enterprise module)

Environment variables used by the bootstrap layer in `traceStore.ts`:

- `OTEL_GUI_PERSISTENCE_MODE`: `memory` or `pglite` (invalid values warn and fall back to `memory`)
- `OTEL_GUI_PERSISTENCE_PATH`: local PGlite data path (default `.otel-gui/pglite`)
- `OTEL_GUI_PERSISTENCE_FLUSH_MS`: flush debounce in ms (50-60000, default `750`)
- `OTEL_GUI_PERSISTENCE_BACKEND_MODULE`: optional module id/path dynamically imported to register extra backends

The runtime exposes persistence status via `getPersistenceStatus()` and `GET /api/config`:

- `mode`, `enabled`, `backend`, `path`, `flushMs`
- `lastRestoreAt`, `restoredTraceCount`, `pendingFlushCount`
- `unavailableReason` when `pglite` is requested but unavailable or failed

External backend interop detail: before dynamically importing backend modules, OSS hydrates selected license-related env vars from `$env/dynamic/private` into `process.env` (`OTEL_GUI_LICENSE_*`) so external modules reading `process.env` still work.

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

**Current status**: 284 unit + integration/component tests, all passing. Run with `pnpm run test`.

**Test files**:

| File                                                                              | What's covered                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [attributes.test.ts](packages/core/src/attributes.test.ts)                        | All 7 AnyValue variants, null/edge cases (canonical tests in `@otel-gui/core`)                                                       |
| [time.test.ts](src/lib/utils/time.test.ts)                                        | Duration formatting, negative/zero, timestamps, relative time                                                                        |
| [spans.test.ts](src/lib/utils/spans.test.ts)                                      | Tree building, orphans, circular refs, child sort order                                                                              |
| [traceStore.test.ts](src/lib/server/traceStore.test.ts)                           | Ingestion, span merging, FIFO eviction, subscribe/unsubscribe, selected trace deletion (`resolveRootSpanName` from `@otel-gui/core`) |
| [integration.test.ts](src/routes/integration.test.ts)                             | Full route coverage including import preview/import, single+bulk export, selected deletion, service map, correlated logs             |
| [ChevronIcon.test.ts](src/lib/components/ChevronIcon.test.ts)                     | SVG render, rotation transform, size prop, aria-hidden                                                                               |
| [ServiceBadge.test.ts](src/lib/components/ServiceBadge.test.ts)                   | Service name text, element/attribute structure, background color                                                                     |
| [AttributeItem.test.ts](src/lib/components/AttributeItem.test.ts)                 | Key/value rendering, all 8 type labels, copy button, truncation, onFullscreen callback                                               |
| [KeyboardShortcutsHelp.test.ts](src/lib/components/KeyboardShortcutsHelp.test.ts) | Shortcuts table, dialog role, close via button/backdrop/Escape key                                                                   |
| [FullscreenValueModal.test.ts](src/lib/components/FullscreenValueModal.test.ts)   | Fullscreen value rendering, interactions, close behavior                                                                             |
| [CopyButton.test.ts](src/lib/components/CopyButton.test.ts)                       | Clipboard interactions, fallback/error handling                                                                                      |
| [SpanDetailsSidebar.test.ts](src/lib/components/SpanDetailsSidebar.test.ts)       | Sidebar rendering, filters, events/links/resources/scope/logs flows                                                                  |
| [spanSearch.test.ts](src/lib/utils/spanSearch.test.ts)                            | Span search tokenization/matching, rank/ordering behaviors                                                                           |
| [updateCheck.test.ts](src/lib/utils/updateCheck.test.ts)                          | Release check caching/dismiss semantics                                                                                              |
| [moduleImport.test.ts](src/lib/server/traceStore/moduleImport.test.ts)            | Dynamic backend module resolution and import behavior                                                                                |
| [server.test.ts](src/routes/api/config/server.test.ts)                            | Config endpoint metadata (maxTraces + persistence fields)                                                                            |
| [page.test.ts](src/routes/traces/[traceId]/page.test.ts)                          | Trace detail page matching behavior with collapsed descendants                                                                       |

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
4. **Gzip request bodies supported** — OTLP receivers accept gzip-compressed payloads
5. **Configurable retention** — `OTEL_GUI_MAX_TRACES` env var (integer 1-10 000, default 1000). FIFO eviction. Read via `$env/dynamic/private` in `traceStore.ts`. Exposed as `traceStore.maxTraces`. Invalid values warn and fall back to 1000.
6. **Persistence is optional** — OSS always has `memory`; `pglite` requires a registered backend (usually via `OTEL_GUI_PERSISTENCE_BACKEND_MODULE`). If unavailable, runtime falls back to memory with `persistence.unavailableReason` in `GET /api/config`.
7. **Update availability check** — On mount, the page fetches `https://api.github.com/repos/metafab/otel-gui/releases/latest` (GitHub API) and compares `tag_name` to `import.meta.env.PACKAGE_VERSION` (embedded at build time from `package.json` via Vite `define`). If a newer semver is found, a non-intrusive notice is shown in the bottom-left of the trace list, next to the retention notice. The notice links to `https://github.com/metafab/otel-gui/releases` and can be dismissed per-version via `localStorage`. The result is cached in `localStorage` (`update-check-cache`) for 1 hour to avoid hitting the GitHub rate limit (60 unauthenticated req/h). Network failures are silent and do not affect the UI.
8. **Import/export UX contract** — list page provides Import, Export Filtered, Export Selected, and split delete actions (`Clear All` + dropdown `Delete Selected (n)`); import always previews metadata before confirmation.

## Reference Files

- [traceStore.ts](src/lib/server/traceStore.ts) — Trace store bootstrap: env parsing, optional backend module loading, fallback policy, `getPersistenceStatus()`
- [backends.ts](src/lib/server/traceStore/backends.ts) — Backend registry (`memory` built-in) and persistence status contracts
- [core.ts](src/lib/server/traceStore/core.ts) — Shared trace/log ingestion, span merging, eviction, and service-map aggregation logic
- [memoryTraceStore.ts](src/lib/server/traceStore/memoryTraceStore.ts) — Default in-memory backend implementation
- [moduleImport.ts](src/lib/server/traceStore/moduleImport.ts) — Dynamic import target resolution for external backend modules
- [protobuf.ts](src/lib/server/protobuf.ts) — Protobuf decoder for OTLP traces
- [packages/core/src/attributes.ts](packages/core/src/attributes.ts) — OTLP AnyValue extraction (`flattenAttributes`, `extractAnyValue`)
- [packages/core/src/traceStore.ts](packages/core/src/traceStore.ts) — Shared pure functions (`createLogId`, `resolveRootSpanName`)
- [packages/core/src/stats.ts](packages/core/src/stats.ts) — Percentile helpers (`percentile`, `percentileNsToMs`)
- [packages/core/src/serviceMap.ts](packages/core/src/serviceMap.ts) — Service map builder (`buildServiceMap`)
- [packages/core/src/types.ts](packages/core/src/types.ts) — Shared store types (`StoredSpan`, `StoredLog`, `StoredTrace`, `ServiceMapNode/Edge/Data`)
- [time.ts](src/lib/utils/time.ts) — BigInt nanosecond formatting
- [graph.ts](src/lib/utils/graph.ts) — Layered graph layout (Sugiyama-style): layer assignment, barycenter ordering, coordinate assignment, Bézier edge paths
- [keyboard.ts](src/lib/utils/keyboard.ts) — `isInputFocused()` guard for global keyboard shortcuts
- [KeyboardShortcutsHelp.svelte](src/lib/components/KeyboardShortcutsHelp.svelte) — `?` help overlay component
- [ServiceMap.svelte](src/lib/components/ServiceMap.svelte) — SVG service map component (full + mini mode); nodes are service/database/messaging shapes; edges show call count, error rate, p50/p99 latency
- [types.ts](src/lib/types.ts) — Complete OTLP data model + `ServiceMapNode`, `ServiceMapEdge`, `ServiceMapData`
- [stream/+server.ts](src/routes/api/traces/stream/+server.ts) — SSE endpoint (debounced, heartbeat)
- [export/+server.ts](src/routes/api/traces/export/+server.ts) — `POST /api/traces/export` bulk export endpoint
- [[traceId]/export/+server.ts](src/routes/api/traces/[traceId]/export/+server.ts) — `GET /api/traces/:traceId/export` endpoint
- [import/preview/+server.ts](src/routes/api/traces/import/preview/+server.ts) — import metadata preview endpoint
- [import/+server.ts](src/routes/api/traces/import/+server.ts) — import execution endpoint
- [service-map/+server.ts](src/routes/api/service-map/+server.ts) — `GET /api/service-map?traceId=` endpoint
- [config/+server.ts](src/routes/api/config/+server.ts) — `GET /api/config` endpoint (`maxTraces` + persistence status)
- [vite.config.ts](vite.config.ts) — Embeds `PACKAGE_VERSION` from `package.json` at build time via `define: { 'import.meta.env.PACKAGE_VERSION': ... }`
- [enterprise-persistence-module.md](docs/enterprise-persistence-module.md) — External backend registration contract for optional persistence modules
- [docs/research.md](docs/research.md) — OTLP protocol details, data model, Honeycomb UI reference, gotchas
- [docs/plan.md](docs/plan.md) — Full implementation plan (16 steps), architecture diagram, deferred v2 features
- [docs/testing.md](docs/testing.md) — Testing strategy, priority test cases, sample test data

## Implementation Philosophy

Deliberately minimal in OSS runtime: no UI libraries and no OTLP libraries. Default storage is in-memory; optional durable storage can be plugged in via external backends (for example enterprise `pglite`). Real-time updates use SSE (`GET /api/traces/stream`) — `traceStore.subscribe()` notifies the stream handler, which debounces and pushes `event: traces` to the client.

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
