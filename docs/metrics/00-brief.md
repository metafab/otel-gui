# Metrics Support — Brief

Status: **proposed** (awaiting review). Owner: TBD. Last updated: 2026-06-24.

otel-gui currently ingests and visualises two OTLP signals — **traces** and **logs**.
This brief assesses adding the third signal, **metrics**, and records the decisions
that scope the work. Detailed, file-by-file plans live alongside this doc:

- [`phase-1.md`](./phase-1.md) — ingest + Gauge/Sum line charts (the usable core)
- [`phase-2.md`](./phase-2.md) — histograms, exponential histograms, summaries, rates
- [`phase-3.md`](./phase-3.md) — persistence + exemplar→trace linking

---

## Current state

- `POST /v1/metrics` and `GET /metrics` exist but return **501 Not Implemented**
  (`src/routes/v1/metrics/+server.ts`, `src/routes/metrics/+server.ts`).
  `src/routes/integration.test.ts` asserts the 501 — this test flips when we implement.
- **No `metrics.proto`** is bundled. `/proto` ships only trace + logs service protos.
- **No charting library** exists in the repo. Traces and logs are tables; metrics are
  inherently time-series and need real charts. This is the defining new surface.
- Everything else is a clean, repeatable pattern metrics can follow: the tab system
  (`src/routes/+page.svelte`), the SSE snapshot/append delta protocol (added for logs),
  the `traceStore` singleton + memory/pglite backend split, detail-page routing, and
  the `OTEL_GUI_MAX_*` config convention.

## Why metrics is not "just logs again"

Two genuinely new problems sit on top of the copy-the-logs-pattern plumbing.

### 1. The data model is richer

An OTLP metric is a `name` + `unit` + exactly one of five shapes:

| Type                  | Data point shape                    | Phase | Render as                     |
| --------------------- | ----------------------------------- | ----- | ----------------------------- |
| Gauge                 | number                              | 1     | line                          |
| Sum (mono + temporal) | number                              | 1     | line / area (often a rate)    |
| Histogram             | bucket counts + explicit bounds     | 2     | distribution bars / heatmap   |
| Exponential Histogram | scale + zero count + scaled buckets | 2     | heatmap                       |
| Summary (legacy)      | quantile values                     | 2     | line per quantile             |

Each data point carries an **attribute set**, so one metric name fans out into many
**series** (e.g. `http.server.duration{route=/a}` vs `{route=/b}`). Storage is therefore
keyed by *(metric name + attribute fingerprint)*, and each series holds a time-ordered
ring of points — a cardinality/retention model the flat `Map<id, log>` does not have.
**Temporality** (delta vs cumulative) and monotonicity must be tracked too.

### 2. Visualisation is the real lift

A metric *list* (name, type, unit, #series, sparkline) mirrors the logs table cleanly.
But the *detail* view needs interactive, live-appending time-series charts. There is
nothing to build on today, so a charting layer is net-new.

---

## Decisions (locked)

| # | Decision                | Choice                                                                 |
| - | ----------------------- | ---------------------------------------------------------------------- |
| 1 | Charting library        | **uPlot** — ~40 KB, no deps, built for streaming time-series (MIT)     |
| 2 | Phase-1 metric types    | **Gauge + Sum only** (line charts); histograms/summary → Phase 2       |
| 3 | Value display           | **Raw** in Phase 1; cumulative→rate computed **in Node** in Phase 2    |
| 4 | Persistence             | **Memory-only**; server-authoritative; pglite deferred to Phase 3      |
| 5 | Client-side persistence | **No IndexedDB** — client mirrors the SSE stream in memory, like logs  |

### Rationale: rate computation belongs in Node

Rate is `(v₂−v₁)/(t₂−t₁)` per series, **with reset detection** (a counter dropping to 0
on process restart must not emit a huge negative spike). That math needs consecutive
points within one series — exactly what the server's per-series ring buffer holds. Doing
it server-side means: computed once (all clients see identical values), reset/temporality
logic centralised where the OTLP payload is already decoded, and the client stays a dumb
renderer. The SSE delta can carry both `raw` and `rate` per point so the UI toggles with
no refetch. Negligible CPU.

### Rationale: no IndexedDB

The app is server-authoritative + memory-only + snapshot-on-SSE-connect. If the browser
cached a *longer* history than the server retains, a reload/reconnect would replay a
server snapshot that no longer contains those points — the client would display data the
server has dropped. For a live-tail debugging tool that divergence is worse than not
caching at all, and it adds async/quota/versioning/reconciliation complexity for no
Phase-1/2 benefit. The client only needs the retained window, which it already gets by
mirroring the SSE stream. Revisit only if "offline review / history beyond server
retention" ever becomes a goal — both contradict "memory only / live tail".

---

## Retention semantics (note the difference from logs)

`OTEL_GUI_MAX_LOGS` bounds a count of **records**. `OTEL_GUI_MAX_METRICS` will bound a
count of **series** (distinct name+attribute combinations), and a second knob
(`OTEL_GUI_MAX_METRIC_POINTS`, default e.g. 600) bounds **points retained per series**.
This must be documented clearly because the units differ from the other two signals.

## Effort (rough)

- **Phase 1:** ~3–5 days. Usable, streaming, flash-free Gauge+Sum Metrics tab.
- **Phase 2:** ~1–1.5 weeks. Full type fidelity + rates + series filtering.
- **Phase 3:** optional. Persistence + exemplar linking.

## Out of scope (for now)

- Alerting / thresholds / PromQL-style querying.
- Aggregation across series server-side (sum/avg/percentile rollups) beyond what a single
  metric's data points provide.
- Downsampling for very long windows (server retention bound makes it unnecessary in P1/2).
