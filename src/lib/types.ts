// OTLP Trace Data Types

// Shared types — canonical source is @otel-gui/core
import type {
  StoredLog,
  StoredSpan,
  StoredTrace,
  ServiceMapData,
  MetricListItem,
  MetricDetail,
  StoredMetric,
} from '@otel-gui/core'

export type {
  SpanEvent,
  SpanLink,
  SpanStatus,
  StoredLog,
  StoredSpan,
  StoredTrace,
  ServiceMapNode,
  ServiceMapEdge,
  ServiceMapData,
  MetricType,
  MetricTemporality,
  MetricPoint,
  HistogramPoint,
  ExpHistogramBuckets,
  ExpHistogramPoint,
  SummaryQuantile,
  SummaryPoint,
  MetricSeriesPoints,
  MetricSeries,
  StoredMetric,
  MetricScalarWirePoint,
  MetricWirePoint,
  MetricSeriesDetail,
  MetricDetail,
  MetricListItem,
} from '@otel-gui/core'

export interface LogListItem {
  id: string
  traceId: string | null
  spanId: string | null
  timeUnixNano: string
  observedTimeUnixNano: string
  severityNumber: number
  severityText: string
  body: unknown
  serviceName: string
}

// Narrows LogListItem for per-trace context where traceId/spanId are always present
export interface TraceLogListItem extends LogListItem {
  traceId: string
  spanId: string
}

export interface TraceLogDetail extends StoredLog {
  id: string
}

export interface TraceListItem {
  traceId: string
  rootSpanName: string
  rootSpanTentative: boolean // true while no true root span (parentSpanId == '') has arrived yet
  serviceName: string
  durationMs: number
  spanCount: number
  logCount?: number
  hasError: boolean
  startTime: string // ISO timestamp for display
  updatedAt: number // epoch ms, copied from StoredTrace
}

// ─── Search ──────────────────────────────────────────────────────────────────
// Deep, case-insensitive substring search over the in-memory corpus. Results
// reuse the list-item projections and add a `matchedIn` breadcrumb naming where
// the query hit (e.g. "body", "span.name", "attribute:http.route") so an agent —
// or the UI — knows why a row surfaced. Shared by the MCP endpoint and (later) a
// UI search box, so the matching lives in the store, not the callers.

export interface SearchMatch {
  /** Field breadcrumbs the query matched, e.g. ["body", "attribute:http.route"]. */
  matchedIn: string[]
}

export interface LogSearchHit extends LogListItem, SearchMatch {}

export interface TraceSearchHit extends TraceListItem, SearchMatch {
  /** Span ids within the trace that matched, for drill-down. */
  matchedSpanIds: string[]
}

export interface MetricSearchHit extends MetricListItem, SearchMatch {}

export interface LogSearchParams {
  query?: string
  service?: string
  /** Minimum OTLP severityNumber (e.g. 17 = ERROR). */
  severityMin?: number
  traceId?: string
  limit?: number
}

export interface TraceSearchParams {
  query?: string
  service?: string
  hasError?: boolean
  limit?: number
}

export interface MetricSearchParams {
  query?: string
  service?: string
  limit?: number
}

export type SearchKind = 'traces' | 'logs' | 'metrics'

export interface SearchAllParams {
  query: string
  /** Which signals to search; defaults to all three. */
  kinds?: SearchKind[]
  service?: string
  /** Per-kind result cap. */
  limit?: number
}

export interface SearchResults {
  traces: TraceSearchHit[]
  logs: LogSearchHit[]
  metrics: MetricSearchHit[]
}

/** Distinct service, with how many of each signal it currently owns. */
export interface ServiceSummary {
  name: string
  traceCount: number
  logCount: number
  metricCount: number
}

export interface TraceExportItem {
  traceId: string
  resourceSpans: any[]
}

export interface TraceExportEnvelope {
  format: 'otel-gui-trace-export'
  version: 1
  exportedAt: string
  traceCount: number
  spanCount: number
  traces: TraceExportItem[]
}

export interface TraceImportPreview {
  format: 'otlp-json' | 'otel-gui-trace-export'
  fileName: string | null
  exportedAt: string | null
  sizeBytes: number
  traceCount: number
  spanCount: number
  services: string[]
  warnings: string[]
}

// Swappable storage interface
export interface TraceStore {
  // Ingestion
  ingestSpans(resourceSpans: any[]): void
  ingestLogs(resourceLogs: any[]): void

  // Trace reads
  getTraceCount(): number
  getTraceList(limit?: number): TraceListItem[]
  getTrace(traceId: string): StoredTrace | undefined
  getServiceMap(traceId?: string): ServiceMapData
  getServiceMapSeq(): number

  // Trace writes
  clearTraces(): void
  deleteTraces(traceIds: string[]): number

  // Log reads
  getLogCount(): number
  getLogList(limit?: number): LogListItem[]
  getMaxLogSeq(): number
  getLogRemovalSeq(): number
  getLogsSince(afterSeq: number, limit?: number): LogListItem[]
  getTraceLogs(traceId: string, limit?: number): LogListItem[]
  getLog(logId: string): TraceLogDetail | undefined

  // Log writes
  clearLogs(): void
  deleteLogs(logIds: string[]): number

  // Metric ingestion + reads
  ingestMetrics(resourceMetrics: any[]): void
  getMetricCount(): number
  getMetricList(limit?: number): MetricListItem[]
  getMetric(id: string): StoredMetric | undefined
  getMetricDetail(id: string): MetricDetail | undefined
  getMaxMetricSeq(): number
  getMetricRemovalSeq(): number
  getMetricsSince(afterSeq: number, limit?: number): MetricListItem[]

  // Metric writes
  clearMetrics(): void
  deleteMetrics(ids: string[]): number

  // Search + service enumeration. Optional so external persistence backends need
  // not implement them; the in-memory store always does. Deep substring scans
  // over the bounded corpus (CPU-only cost). See src/lib/server/mcp.
  searchLogs?(params: LogSearchParams): LogSearchHit[]
  searchTraces?(params: TraceSearchParams): TraceSearchHit[]
  searchMetrics?(params: MetricSearchParams): MetricSearchHit[]
  searchAll?(params: SearchAllParams): SearchResults
  listServices?(): ServiceSummary[]

  // Infrastructure
  subscribe(fn: () => void): () => void
  /**
   * Diagnostic snapshot of every internal collection size. Optional so external
   * backends need not implement it; the in-memory store always does. Used by the
   * periodic stats logger to spot unbounded growth (see traceStore.ts).
   */
  getStoreStats?(): StoreStats
  readonly maxTraces: number
  readonly maxLogs: number
  readonly maxMetrics: number
  readonly maxMetricPoints: number
}

/**
 * A point-in-time count of every server-side collection that could grow. Every
 * field is a map/set size (or a derived total) so a rising number pinpoints
 * exactly which store is accumulating.
 */
export interface StoreStats {
  traces: number
  logs: number
  metrics: number
  /** Sum of series across all metrics — the primary metric-cardinality signal. */
  metricSeries: number
  /** Largest single metric's series count, with its key, to name the offender. */
  maxSeriesInMetric: number
  maxSeriesMetricKey: string | null
  /** Sum of retained points across all series (bounded by maxMetricPoints each). */
  metricPoints: number
  serviceMapNodes: number
  serviceMapEdges: number
  /** Service-map per-span bookkeeping ledgers (pruned on trace eviction). */
  serviceMapSpanService: number
  serviceMapCountedNodeSpans: number
  serviceMapResolvedEdgeSpans: number
  serviceMapPendingChildren: number
  /** Log/trace bookkeeping maps (should track logs/traces, not outgrow them). */
  traceLogCounts: number
  logTraceIdByLogId: number
  logSeqById: number
  metricSeqById: number
  /**
   * Active change-notification subscribers. In practice one per open SSE
   * connection — if this climbs without bound, streams are not unsubscribing on
   * disconnect (a listener/timer/controller leak outside the data stores).
   */
  subscribers: number
}

// Span tree node for waterfall rendering
export interface SpanTreeNode {
  span: StoredSpan
  depth: number
  children: SpanTreeNode[]
  collapsed: boolean
  /** Total number of descendant spans (direct + indirect). 0 for leaf nodes. */
  subtreeSize: number
  /** True for synthetic placeholder nodes representing a missing parent span. */
  isPhantom?: boolean
}
