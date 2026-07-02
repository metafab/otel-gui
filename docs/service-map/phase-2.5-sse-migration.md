# Phase 2.5 — Migrate the Service Map to SSE streaming

Status: **proposed** (design only — not yet implemented)
Author: design pass, 2026-06-25
Scope: two coupled fixes for the Service Map tab —
1. **Transport**: replace the HTTP-polling refresh with the same
   Server-Sent-Events (SSE) push contract the Logs, Metrics, and Trace-list
   views already use.
2. **Render**: replace the full-recompute layout with a **stable, expand-only,
   never-age-out** layout that grows as services/edges appear and updates counts
   in place, instead of reflowing the whole graph on every change.

---

## 1. Problem

There are **two** distinct problems behind what looks like one "flashing" map.

### 1a. Transport — the network storm

The Service Map tab refreshes its data by **re-fetching the entire map over
HTTP**, driven by trace-stream churn.

Measured against the running container (`http://localhost:4318/?tab=map`) while
streaming cross-service traces:

| Metric | Observed |
| --- | --- |
| `GET /api/service-map` requests | **798 in 6 s (~133 req/s)** |
| Open SSE connections for the map | 0 |
| Server work per request | full `buildServiceMap(allTraces)` — O(traces × spans), incl. sorting every edge's `durations[]` and recomputing p50/p99 |

Every one of those requests rebuilds the whole graph from scratch and re-ships
the full JSON, even when nothing changed. This is the same class of problem the
Logs view had before the SSE migration, except here it manifests as a **network
+ CPU storm** rather than a visual flash.

### Root cause

In `src/routes/+page.svelte` the map fetch is tied to trace-store reactivity /
a short interval instead of a push stream. Either form is pull-based polling:

- the deployed form re-fetches on **every trace-stream tick** (hence ~133/s
  under load);
- even the interval form (1 req / 2 s) still does a full server-side rebuild on
  a fixed cadence regardless of whether the trace set changed, and fans out to
  one rebuild *per client per tick*.

The map is the only major view still on this model. Logs, Metrics, and the
Trace list were all moved to SSE deltas.

### 1b. Render — the unstable reflow

Even with the data fetch fixed, the *graph itself* visibly jumps and "redraws
itself to match the flow" whenever the topology changes. This is independent of
the network storm — it's the layout.

`ServiceMap.svelte` computes `layout = $derived(layoutGraph(data.nodes,
data.edges))`, a **pure recompute from scratch on every data change**
(`src/lib/utils/graph.ts`). Because the layout is recomputed globally:

- **Vertical recentre.** Each layer is centred with
  `startY = (totalHeight − layerHeight) / 2`, and `totalHeight` depends on the
  busiest layer. Add one node anywhere and `totalHeight` changes → **every**
  layer's nodes shift vertically.
- **Within-layer reorder.** Step 4's barycenter sort reorders nodes inside a
  layer based on the current edge set, so a new edge can swap two existing
  nodes' positions.
- **Canvas resize.** A new layer changes `viewWidth`/`viewHeight`, so the whole
  `<svg>` resizes and the graph appears to lurch.

The result: existing nodes never hold still. What the user wants instead:

- **Expand-only layout** — when a new service/edge appears, *add* it; never
  reposition the nodes already on screen.
- **Update in place** — existing nodes/edges just update their counts/labels.
- **Never age out** — once a service or dependency edge has been seen, it stays
  on the map (it must not vanish when its traces are evicted from the ring).

---

## 2. Architectural principles already in use (the target contract)

These are the principles the Logs / Metrics / Trace-list streams share. The map
migration should adopt them verbatim where applicable.

1. **One long-lived SSE connection per view**, not polling.
   `new EventSource('/api/<view>/stream')`.
2. **Snapshot-on-connect, then incremental updates.** The server sends the full
   current state once (`*-snapshot`) on connect and after any clear/delete, then
   sends only what changed (`*-append`) thereafter.
3. **Monotonic sequence cursor.** Each ingest bumps a `seq`; each connection
   tracks a `lastSeq`; `getXSince(afterSeq)` returns only what is newer. This is
   what makes deltas possible without diffing.
4. **Separate removal sequence.** Deletes/clears bump a `removalSeq`. A cursor
   can express "new items appeared" but not "items vanished", so when
   `removalSeq` changes the server re-snapshots instead of appending.
5. **Server-side debounce (100 ms).** Batched OTLP exports arrive in bursts;
   debouncing coalesces a burst into a single outbound update.
6. **Heartbeat + buffering headers.** A `: heartbeat` comment every 30 s keeps
   proxies/load-balancers from idling the connection out; responses set
   `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
   `Connection: keep-alive`, `X-Accel-Buffering: no`.
7. **Client merges in place.** State is held in `$state.raw`; updates upsert/
   replace without tearing down the component. `isLoading` flips to `false` only
   on the **first** snapshot, never on subsequent updates.
8. **Construct the render target once, mutate on update.** (uPlot is built once
   and fed via `setData`; the heatmap canvas is drawn into, never remounted.)
   For the map this means: keep `<ServiceMap>` mounted and swap its `data` prop —
   never gate it behind an `{#if loading}` that unmounts it.
9. **A decoupled count event** for the tab badge, independent of the payload.
10. **Graceful fallback.** When `EventSource` is undefined (SSR/legacy), fall
    back to a one-shot REST load. `EventSource` auto-reconnects on error and the
    reconnect replays a fresh snapshot.

Reference implementations:
`src/routes/api/logs/stream/+server.ts`,
`src/routes/api/metrics/stream/+server.ts`,
`src/lib/stores/metrics.svelte.ts`.

---

## 3. Architectural principles of *building* the service map

The map differs from logs/metrics in one important way, and the design has to
account for it.

- **It is a derived aggregate, not an append-only list.** Logs and metrics are
  collections of items with stable ids; a delta is "here are the new items".
  The service map is a *pure function of all traces*:
  `buildServiceMap(traces) → { nodes, edges }`
  (`packages/core/src/serviceMap.ts`). A new span doesn't add a "map item"; it
  mutates aggregate node counts, edge call/error counts, and recomputed
  percentiles.
- **Aggregation model** (for reference):
  - **Nodes** — one per `service.name`; CLIENT spans (`kind === 3`) with
    `db.system` / `messaging.system` / `rpc.system` / `peer.service` attributes
    synthesize external `database` / `messaging` / `rpc` nodes.
  - **Edges** — cross-service parent→child (`parentSvc !== svc`), plus
    attribute-based CLIENT→external edges (only when no parent edge already
    covers the call). Each edge accumulates `callCount`, `errorCount`, and a
    `durations[]` array, from which `p50Ms`/`p99Ms` are computed.
- **The payload is small and bounded.** Even a busy system is a handful of nodes
  and a few dozen edges — single-digit KB of JSON. (The `durations[]` arrays can
  grow; see §6.3.)
- **Layout is *not* stable today — and that's the §1b bug.** `<ServiceMap>` keys
  its `{#each}` blocks by `serviceName` / `source||target`, so the DOM elements
  are *not* torn down on update (good — no remount flash). But `layoutGraph`
  recomputes every node's `x`/`y` from the whole set, so the keyed elements have
  their position attributes rewritten and **visibly jump**. Keyed reconciliation
  prevents a remount; it does not prevent a reflow. The render rewrite has to
  make the *positions themselves* sticky (§4.2).
- **The displayed map should be cumulative, not a window over live traces.**
  `buildServiceMap` today aggregates only the *currently retained* traces, so an
  evicted trace's unique service/edge silently drops out — violating "never age
  out". The map should instead be a **persistent, session-lifetime topology +
  stats accumulator**, decoupled from the trace ring and cleared only on an
  explicit clear action.

**Consequence for the delta design:** because the map is a small aggregate, a
true per-node/per-edge delta protocol buys little over re-sending the (tiny)
snapshot, while adding complexity (per-element seq, removal tracking,
mutable-aggregate reconciliation). The recommended design streams **snapshots
over SSE** of the *cumulative* aggregate, gated by a change cursor. Stability
and expand-only behaviour are then a **client render-layer** concern (sticky
layout, §4.2), not a wire-format concern — full snapshots are fine because the
client merges them into a persistent layout and never removes anything.

---

## 4. Design

### 4.1 Recommended — "snapshot over SSE" (Option A)

Push a full map snapshot over a persistent SSE connection, but only when the
underlying trace set has changed (debounced). This eliminates the storm
(133 req/s → ~0, one open stream) and the redundant rebuilds, while reusing the
existing infrastructure almost wholesale.

**Server — persistent cumulative aggregate (`traceStore/core.ts`)**

Rather than rebuilding from the live trace ring on demand, maintain a standing
service-map aggregate that is updated *incrementally as spans are ingested* and
**never pruned by trace eviction** (satisfying "never age out"):

- A module-level `serviceMapAgg` holding `nodeMap` and `edgeMap` (the same
  structures `buildServiceMap` builds today: per-node span/error counts; per-edge
  call/error counts + latency stats).
- In `ingestSpans`, fold each span into `serviceMapAgg` using the existing
  node/edge detection logic from `buildServiceMap` (extract it into a shared
  `accumulateSpan(agg, trace, span)` so the algorithm lives in one place).
  Counts are cumulative for the session.
- The aggregate is **not** touched by trace eviction. It is reset only by
  `clearTraces` / an explicit "clear map" action.
- Add `serviceMapSeq` (a counter), bumped whenever the aggregate changes
  (ingest) or is cleared. Expose `getServiceMapSeq(): number`.
- `getServiceMap(undefined)` returns a snapshot projected from `serviceMapAgg`
  (compute edge p50/p99 at projection time), memoised by `serviceMapSeq` so
  repeated calls at the same seq — multiple SSE clients on one tick, plus the
  REST endpoint — are free.
- The filtered, per-`traceId` path (mini-map) keeps building on demand from the
  one trace as it does today — it is not cumulative and not cached.

There is no separate removal cursor: the cumulative map only grows (or is fully
cleared), so `serviceMapSeq` alone is sufficient and every change re-snapshots.

**Server — new endpoint `src/routes/api/service-map/stream/+server.ts`**

Mirror the logs/metrics stream structure:

- Events:
  - `map-snapshot` — `JSON.stringify({ nodes, edges })`; sent on connect and on
    every debounced change.
  - `map-count` — service-node count, for the tab badge (optional but matches
    principle #9).
- On connect: send `map-count` + `map-snapshot`, record `lastSeq =
  getServiceMapSeq()`.
- `subscribe()` + 100 ms debounce: if `getServiceMapSeq() !== lastSeq`, recompute
  (memoised) and send a fresh `map-snapshot`; update `lastSeq`.
- 30 s heartbeat; same SSE headers; `cleanup()` on cancel/disconnect.

No `map-append` event — snapshots only (see §3 rationale).

**Shared types** — already present: `ServiceMapData` / `ServiceMapNode` /
`ServiceMapEdge` in `@otel-gui/core`, re-exported from `src/lib/types.ts`. Add
`getServiceMapSeq` to the `TraceStore` interface.

**Client store — new `src/lib/stores/serviceMap.svelte.ts`** (mirrors
`metrics.svelte.ts`):

- `data = $state.raw<ServiceMapData>({ nodes: [], edges: [] })`,
  `count = $state(0)`, `isLoading = $state(true)`, `error = $state<string|null>`.
- `connectSSE()`:
  - `EventSource('/api/service-map/stream')`;
  - `map-snapshot` → replace `data`, `isLoading = false`, `error = null`;
  - `map-count` → `count`;
  - `onerror` → no-op (auto-reconnect replays a snapshot);
  - `EventSource` undefined → one-shot `fetch('/api/service-map')` fallback;
  - returns `() => es.close()`.

**Page rewiring — `src/routes/+page.svelte`**

- Delete `fetchServiceMap()` and the `setInterval`.
- In the `activeTab === 'map'` `$effect`, call `serviceMapStore.connectSSE()` and
  return its cleanup so the stream opens on tab-entry and closes on leave
  (conserves the connection when the map isn't being viewed; a fresh snapshot on
  re-entry is cheap). *(Alternative: connect once at mount like Metrics does, if
  we later want the badge live across tabs — note the tradeoff, don't do both.)*
- Render: keep `<ServiceMap data={serviceMapStore.data} />` **mounted** whenever
  on the tab; show the loading placeholder only when
  `serviceMapStore.isLoading && data.nodes.length === 0`, and the error inline
  without unmounting the map.

**Keep the REST endpoint** (`/api/service-map`): still used by the per-trace
mini-map (`mini` prop, one-shot) and as the no-`EventSource` fallback. It
benefits from the new memoisation for the global case.

### 4.2 Recommended — stable, expand-only render

This is the fix for §1b and is independent of the transport. The goal: once a
node is on screen it never moves; new nodes/edges are *added*; counts update in
place; nothing is removed.

**Make layout positions sticky (persistent), not recomputed.** Today
`layoutGraph` is a pure function of the current set, so it recentres everything.
Replace the "recompute every frame" model with an **incremental layout that
remembers placements**:

- Maintain a persistent `placements: Map<serviceName, { layer, slot, x, y }>`
  (in the store or a layout module — outlives any single snapshot).
- On each snapshot, **diff against `placements`**:
  - **Existing node** → keep its `{x, y}` exactly; only refresh `spanCount` /
    `errorCount` / labels.
  - **New node** → assign a layer (BFS depth from roots, as today — but a node's
    layer is fixed the first time it's placed and never recomputed), then the
    next free `slot` at the *bottom* of that layer. Compute `{x, y}` from
    `(layer, slot)` and store it. The canvas **grows** downward/rightward to fit;
    existing nodes do not move.
  - **Edges** → add new ones; update counts/latency on existing ones; recompute
    only the bezier `path` of edges whose endpoints are new (existing endpoints
    haven't moved, so their paths are stable).
  - **Disappeared node/edge** (not in this snapshot) → **keep it** (never age
    out). With the cumulative server aggregate (§4.1) this case shouldn't arise,
    but the client enforces it regardless: it merges, never replaces wholesale.
- Coordinates use fixed `LAYER_GAP_X` / `NODE_H + NODE_GAP_Y` slot math so a slot
  index maps to a deterministic position — no global recentre term.

**Component (`ServiceMap.svelte`)** stops deriving layout from raw data via the
recomputing `layoutGraph`. Instead it reads the persistent `placements` +
per-element counts; `{#each}` stays keyed by `serviceName` / `source||target`
(already correct). Because positions are now stable, keyed reconciliation
updates only counts/labels and never rewrites `x`/`y` — the graph stops jumping.
A subtle CSS transition on node `transform` can make the *appearance* of a new
node smooth without moving the incumbents.

**`layoutGraph` refactor**: split into (a) `assignLayer(name)` / `nextSlot(layer)`
incremental helpers that mutate `placements`, and (b) a pure
`coordsFor(layer, slot)` + `edgePath(srcPos, tgtPos)`. The current barycenter
reorder is dropped for placed nodes (it's the main source of jumping); it may
optionally run **once** for a node's initial slot choice within its layer.

**Optional niceties** (not required for stability): a "re-tidy layout" button
that recomputes placements from scratch (explicit, user-initiated, so never a
surprise jump); a subtle fade-in for newly added nodes/edges.

### 4.3 Deferred — structural deltas (Option B)

Send `map-snapshot` on connect, then `map-patch` events carrying only
changed/added/removed nodes and edges (keyed). This would need per-element
sequencing, removal tracking, and client-side reconciliation of mutable
aggregates (counts + recomputed percentiles). Given the map payload is single-
digit KB, the diffing complexity outweighs the bandwidth saved. **Document as
future work; do not build now.** Revisit only if real deployments show very
large maps (hundreds of nodes/edges).

---

## 5. Why this is the right call

Transport (§4.1):
- Kills the storm: ~133 req/s of full rebuilds → one idle SSE connection that
  emits only on actual change, debounced.
- Reuses the proven logs/metrics contract — low risk, consistent codebase.
- The cumulative aggregate makes the surviving REST path and the multi-client
  case cheap (memoised by `serviceMapSeq`), and gives "never age out" for free.

Render (§4.2):
- Sticky placements fix the actual visible "flashing": existing nodes stop
  moving, the graph only *expands*, counts update in place.
- Keeping the component mounted + keyed reconciliation means no remount; sticky
  positions mean no reflow — together that is genuinely flash-free, which
  mounting-alone was **not** (the earlier loading-gate fix stopped the
  placeholder flash but not the layout jump).

Overall: contained surface area — one store, one endpoint, one aggregate +
cursor on the trace store, an incremental-layout refactor, a few lines of page
wiring.

---

## 6. Risks & details

1. **Multi-client recompute.** Each SSE connection has its own `subscribe`
   callback, so without care N clients = N rebuilds per tick. The
   `serviceMapSeq`-keyed memo collapses these to one build per change. (For a
   dev tool this is usually 1–2 tabs, but the memo is cheap insurance.)
2. **Connect-on-tab vs connect-on-mount.** Connect-on-tab keeps zero open
   streams when the map isn't viewed but re-sends a snapshot on each entry
   (cheap). Connect-on-mount keeps the badge live everywhere but holds a stream
   open always. Recommendation: connect-on-tab, matching the current lazy
   behaviour. Pick one — never both.
3. **Cumulative `durations[]` growth.** Because the aggregate is now session-
   lifetime (no eviction), edge `durations[]` arrays grow unbounded under high
   call volume, and p50/p99 over all-time is less useful than recent latency.
   Mitigation: keep `callCount`/`errorCount` cumulative but compute latency over
   a **bounded rolling window** (e.g. last N durations per edge) or a streaming
   estimator (p-square / t-digest). Counts never age out; latency is windowed.
   Decide the window in implementation; flagged here as the main new cost of
   "never age out".
4. **Memory of a never-pruned map.** Topology is tiny in practice, but a noisy
   environment that emits many one-off `peer.service` values could accumulate
   nodes. Acceptable for a dev tool; the explicit "clear map" action is the
   escape hatch. Note if it ever bites.
5. **Layer assignment is first-seen-wins.** A node's layer is fixed when first
   placed; if a later trace implies it "should" sit in a different layer, it
   stays put (the price of stability). A user-initiated "re-tidy" recomputes.
6. **Slot growth only downward.** New nodes append to the bottom of their layer,
   so a long-running session's busiest layer gets tall. Acceptable; the wrap is
   the scroll container. Re-tidy rebalances if wanted.

---

## 7. Validation plan (Playwright MCP @ `http://localhost:4318/?tab=map`)

1. **No more storm.** Probe the page's resource timing over a 6 s window while
   streaming traces: `GET /api/service-map` count **== 0**, SSE connections to
   `/api/service-map/stream` **== 1** (vs 798 polls today).
2. **Live correctness.** Stream cross-service traces (`gentraces.mjs`); assert
   nodes/edges appear and counts update live; error edges render dashed/red.
3. **DOM stability (no remount).** Over a streaming window assert the `<svg>` is
   never removed, node `<g>` elements keep identity (no remount), and the
   loading placeholder never reappears after the first paint.
4. **Position stability (no reflow) — the §1b check.** Snapshot each node `<g>`'s
   `transform` (x/y); stream new traces that add a *new* node/edge; assert every
   **pre-existing** node's transform is byte-for-byte unchanged, while the new
   node appears and `viewBox` only grows (never shrinks/recentres).
5. **Never age out.** Stream a service, let its traces age past the retention
   ring, keep streaming others; assert the original node/edge is still present.
6. **Counts update in place.** Assert an existing edge's `callCount` label
   increments without its path/position changing.
7. **Reconnect.** Restart the dev server; confirm `EventSource` reconnects and a
   fresh `map-snapshot` repaints, and (with the persistent client placements) the
   re-laid map keeps the same positions.
8. **Fallback.** With `EventSource` disabled, confirm the one-shot REST load
   still renders the map.

---

## 8. Out of scope

- Structural `map-patch` deltas (§4.3).
- Advanced percentile estimators / t-digest (a simple rolling window covers §6.3
  for now).
- Streaming the per-trace mini-map (stays one-shot REST).
- Auto re-tidy / force-directed relayout (only an explicit, user-initiated
  re-tidy button, if any).
- Phase 3 metrics persistence (separate, parked).

---

## 9. File touch-list (for implementation)

| File | Change |
| --- | --- |
| `packages/core/src/serviceMap.ts` | extract `accumulateSpan(agg, trace, span)` (shared node/edge detection); add a `projectServiceMap(agg)` that computes p50/p99 (windowed) |
| `src/lib/server/traceStore/core.ts` | hold persistent `serviceMapAgg`; fold spans in `ingestSpans`; **don't** prune on eviction; reset on `clearTraces`; `serviceMapSeq` + bumps; memoised `getServiceMap(undefined)`; `getServiceMapSeq()` |
| `src/lib/types.ts` | add `getServiceMapSeq` to `TraceStore` |
| `src/routes/api/service-map/stream/+server.ts` | **new** SSE endpoint (`map-snapshot` / `map-count`) |
| `src/lib/stores/serviceMap.svelte.ts` | **new** client store (`connectSSE`, `$state.raw` data, persistent placements + merge, REST fallback) |
| `src/lib/utils/graph.ts` | refactor `layoutGraph` → incremental: persistent `placements`, `assignLayer`/`nextSlot`, pure `coordsFor`/`edgePath`; existing nodes never move |
| `src/lib/components/ServiceMap.svelte` | read sticky placements + per-element counts instead of recomputing layout each render; keep keyed `{#each}`; optional new-node fade-in |
| `src/routes/+page.svelte` | drop `fetchServiceMap` + interval; wire `serviceMapStore.connectSSE()`; keep `<ServiceMap>` mounted |
| `src/routes/api/service-map/+server.ts` | unchanged API (mini-map + fallback; global path now reads the cumulative aggregate) |
