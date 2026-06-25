# Metrics — Phase 3 (optional): Persistence + exemplar linking

Builds on Phases 1–2. Entirely optional; pursue only if the requirements below become real.
Memory-only remains the default and the OSS behaviour.

---

## 1. Persistence (pglite backend)

Today only the **memory** backend ships in OSS; persistence is an external pglite backend
loaded via `OTEL_GUI_PERSISTENCE_BACKEND_MODULE` (see
[`../enterprise-persistence-module.md`](../enterprise-persistence-module.md)). Metrics are
memory-only in Phases 1–2.

To persist metrics, the external backend module must implement the metrics half of the
`TraceStore` interface added in Phase 1 (`ingestMetrics`, `getMetricList`, `getMetric`,
`clearMetrics`, `deleteMetrics`, the seq/delta methods, `maxMetrics`,
`maxMetricPoints`). Work involved:

- **Schema:** a `metrics` table (id, name, type, unit, service, temporality, monotonic,
  lastUpdated) + a `metric_points` table (metric_id, series_id, attributes JSON, t, v) —
  or a compact per-series blob, depending on the existing pglite shape.
- **Flush/restore:** follow the trace flush cadence (`OTEL_GUI_PERSISTENCE_FLUSH_MS`) and
  restore-on-boot path; extend `traceTransfer.ts` equivalents for metrics if the
  import/export feature should cover metrics too.
- **Retention:** reconcile DB-side retention with `maxMetrics`/`maxMetricPoints` so the
  store and disk agree (avoid the divergence problem the brief flags for client caches).

This is primarily work in the **enterprise persistence module**, not the OSS repo — the
OSS side only needs the interface (delivered in Phase 1) and a memory implementation.

## 2. Exemplar → trace linking

OTLP data points can carry **exemplars** — sample observations with `traceId` / `spanId`.
This is the highest-value cross-signal feature: jump from a latency spike on a chart
straight to the trace that caused it.

- **Ingest:** capture `exemplars[]` per data point in `core.ts` (the proto decode already
  hex-encodes their trace/span IDs via `convertBytesToHex`). Store a bounded set per series.
- **Render:** plot exemplars as clickable points on the uPlot chart (a scatter series via a
  uPlot `points` hook). Click → navigate to `/traces/[traceId]` (deep-link to the span if
  `spanId` present), reusing the existing trace detail route.
- **Guard:** only link when the referenced trace actually exists in the store (memory-only
  means it may have been evicted) — fall back to a non-clickable marker otherwise.

## 3. Possible extras (only if asked)

- **Import/Export** parity for metrics in `TraceImportModal` / `traceTransfer.ts`.
- **Downsampling** for very long retention windows (only relevant if `maxMetricPoints`
  grows large enough to strain the chart).

## Definition of done (Phase 3)

- Metrics survive restart when a pglite backend is configured (enterprise), with retention
  consistent between store and disk.
- Exemplars are clickable on charts and deep-link to existing traces/spans.
