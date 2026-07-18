# Metrics — Phase 2: Full type fidelity + rates + series filtering

Builds on Phase 1. Adds the remaining OTLP metric types, server-side rate computation,
and richer series interaction. Still memory-only.

Prereq: Phase 1 merged (ingest pipeline, store, streams, Metrics tab, uPlot wrapper).

---

## 1. Histograms

**Model** (`packages/core/src/types.ts`) — extend `MetricType` with `'histogram'`; add a
distinct point shape (a histogram point is not a single number):

```ts
export interface HistogramPoint {
  t: number
  count: number
  sum?: number
  min?: number
  max?: number
  bucketCounts: number[] // length = explicitBounds.length + 1
  explicitBounds: number[]
}
```

Store these on a parallel `histogramSeries` (or a tagged union on `MetricSeries`) so a
metric carries the right point type for its `type`.

**Ingest** (`core.ts ingestMetrics`) — stop skipping `histogram`; map
`HistogramDataPoint` fields. Trim per-series like Phase 1.

**Render** — two views in `UplotChart` / the detail page:

- **Distribution (latest point):** bar chart of `bucketCounts` across `explicitBounds`.
- **Heatmap over time:** x = time, y = bucket, colour = count. uPlot supports this via a
  custom `paths`/`draw` hook drawing rects; encapsulate in a `HistogramHeatmap.svelte` that
  wraps `UplotChart` or draws to its own canvas. This is the heaviest single piece — budget
  for it explicitly.

## 2. Exponential histograms

Extend `MetricType` with `'exp_histogram'`. Convert `scale` + `zeroCount` + positive/
negative `buckets{offset, bucketCounts}` into effective bounds for the same heatmap/bar
renderer (a `expoBoundsForBucket(scale, index)` helper). Reuse the histogram view.

## 3. Summaries (legacy)

Extend `MetricType` with `'summary'`. A summary point is `count`, `sum`, and
`quantileValues[]` (`{ quantile, value }`). Render one line per quantile on the existing
line chart (Phase-1 `UplotChart` handles multi-series directly — one series per quantile).

## 4. Rate computation (server-side)

The headline Phase-2 feature. **All of it lives in Node** (see brief rationale).

- In `core.ts`, add a derived view over Sum series with `temporality === 'cumulative'`:
  `rate(p_i) = (v_i − v_{i-1}) / ((t_i − t_{i-1}) / 1000)` (per second).
- **Reset detection:** if `v_i < v_{i-1}`, treat as a counter reset — emit `v_i / Δt`
  (assume restart from 0) rather than a negative value.
- **Delta sums** are already per-interval; expose `v_i / Δt` directly.
- Carry **both** raw and rate per point in the detail payload / stream
  (`{ t, v, rate }`), so the UI toggles raw↔rate with no refetch.
- Add a `valueMode: 'raw' | 'rate'` toggle to the detail page; default to **rate** for
  monotonic cumulative sums (that's what makes counters readable), **raw** otherwise.

## 5. Series filtering & overlay UX

- Attribute-based series filtering on the detail page (e.g. show only `route=/api/*`):
  a per-series legend with checkboxes + an attribute filter input.
- Cap simultaneously-plotted series (e.g. top-N by latest value) with a "showing N of M
  series" note — never silently truncate.
- Optional: server-side `getMetric(id, { seriesLimit, attrFilter })` to avoid shipping
  huge high-cardinality metrics to the client wholesale.

## 6. Tests

- Ingest + render for each new type (histogram, exp-histogram, summary).
- Rate math: monotonic increase, reset/restart, delta vs cumulative, single-point (no
  rate yet), irregular intervals.
- Exp-histogram bucket→bounds conversion correctness.

## Definition of done (Phase 2)

- All five OTLP metric types ingest and render with type-appropriate charts.
- Cumulative counters display as rates by default, raw on toggle, with correct reset
  handling — computed entirely server-side.
- Series filtering keeps high-cardinality metrics usable.
