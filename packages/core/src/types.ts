// Shared OTLP store types — used by both the OSS traceStore and the enterprise persistence module

export interface SpanEvent {
  timeUnixNano: string
  name: string
  attributes: Record<string, any>
}

export interface SpanLink {
  traceId: string
  spanId: string
  traceState: string
  attributes: Record<string, any>
}

export interface SpanStatus {
  code: number // 0=UNSET, 1=OK, 2=ERROR
  message: string
}

export interface StoredLog {
  traceId: string
  spanId: string
  timeUnixNano: string
  observedTimeUnixNano: string
  severityNumber: number
  severityText: string
  body: unknown
  attributes: Record<string, any>
  resource: Record<string, any>
  scopeName: string
  scopeVersion: string
  scopeAttributes: Record<string, any>
}

export interface StoredSpan {
  traceId: string
  spanId: string
  parentSpanId: string
  name: string
  kind: number // 0-5 (SpanKind enum)
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Record<string, any>
  events: SpanEvent[]
  links: SpanLink[]
  status: SpanStatus
  resource: Record<string, any>
  scopeName: string
  scopeVersion: string
  scopeAttributes: Record<string, any>
}

export interface StoredTrace {
  traceId: string
  rootSpanName: string
  serviceName: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  updatedAt: number
  spanCount: number
  hasError: boolean
  spans: Map<string, StoredSpan>
  logs?: Map<string, StoredLog>
  logCount?: number
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export type MetricType =
  | 'gauge'
  | 'sum'
  | 'histogram'
  | 'exp_histogram'
  | 'summary'
export type MetricTemporality = 'delta' | 'cumulative'

// Gauge + Sum: a point is a single scalar value.
export interface MetricPoint {
  t: number // epoch ms (from timeUnixNano)
  v: number // asDouble ?? Number(asInt)
}

// Explicit-bucket histogram point. `bucketCounts.length === explicitBounds.length + 1`
// (one overflow bucket above the highest bound).
export interface HistogramPoint {
  t: number // epoch ms
  count: number
  sum?: number
  min?: number
  max?: number
  bucketCounts: number[]
  explicitBounds: number[]
}

// One bucket layer (positive or negative) of an exponential histogram.
export interface ExpHistogramBuckets {
  offset: number // index of the first populated bucket
  bucketCounts: number[]
}

// Exponential (base-2^(2^-scale)) histogram point.
export interface ExpHistogramPoint {
  t: number // epoch ms
  count: number
  sum?: number
  min?: number
  max?: number
  scale: number
  zeroCount: number
  positive: ExpHistogramBuckets
  negative: ExpHistogramBuckets
}

// Legacy summary quantile sample.
export interface SummaryQuantile {
  quantile: number // 0..1 (0.5 = median, 1 = max)
  value: number
}

// Summary point: total count + sum plus pre-computed quantiles.
export interface SummaryPoint {
  t: number // epoch ms
  count: number
  sum: number
  quantileValues: SummaryQuantile[]
}

// `MetricSeries.points` is discriminated by the owning metric's `type`:
//   gauge | sum         -> MetricPoint[]
//   histogram           -> HistogramPoint[]
//   exp_histogram       -> ExpHistogramPoint[]
//   summary             -> SummaryPoint[]
export type MetricSeriesPoints =
  | MetricPoint[]
  | HistogramPoint[]
  | ExpHistogramPoint[]
  | SummaryPoint[]

export interface MetricSeries {
  seriesId: string // attribute fingerprint
  attributes: Record<string, unknown>
  points: MetricSeriesPoints // time-ordered ring, bounded by maxMetricPoints
}

export interface StoredMetric {
  name: string
  description: string
  unit: string
  type: MetricType
  temporality?: MetricTemporality // sum / histogram / exp_histogram
  isMonotonic?: boolean // sum only
  serviceName: string
  series: Map<string, MetricSeries>
  lastUpdated: number // epoch ms
}

// ─── Detail (wire) projection ─────────────────────────────────────────────────
// Read-time shape sent to the client. For cumulative/delta Sums each point also
// carries a server-computed `rate` (per-second). Other types pass through.

// gauge/sum point on the wire: `rate` present only for sum series where it is
// computable (never on the first point of a series; never for gauge).
export interface MetricScalarWirePoint {
  t: number
  v: number
  rate?: number
}

export type MetricWirePoint =
  | MetricScalarWirePoint
  | HistogramPoint
  | ExpHistogramPoint
  | SummaryPoint

export interface MetricSeriesDetail {
  seriesId: string
  attributes: Record<string, unknown>
  points: MetricWirePoint[]
}

export interface MetricDetail {
  id: string
  name: string
  description: string
  unit: string
  type: MetricType
  temporality?: MetricTemporality
  isMonotonic?: boolean
  serviceName: string
  lastUpdated: number
  series: MetricSeriesDetail[]
}

// List-view projection (cheap to stream/render)
export interface MetricListItem {
  id: string // = metric key
  name: string
  type: MetricType
  unit: string
  serviceName: string
  seriesCount: number
  lastUpdated: number
  sparkline: number[] // last N values of the busiest series (gauge/sum/count proxy)
}

export interface ServiceMapNode {
  serviceName: string
  spanCount: number
  errorCount: number
  nodeType: 'service' | 'database' | 'messaging' | 'rpc'
  system?: string
}

export interface ServiceMapEdge {
  source: string
  target: string
  callCount: number
  errorCount: number
  /** Sorted durations array (nanoseconds as numbers) for percentile computation */
  durations: number[]
  p50Ms: number
  p99Ms: number
}

export interface ServiceMapData {
  nodes: ServiceMapNode[]
  edges: ServiceMapEdge[]
}

// ─── Cumulative service-map aggregate ──────────────────────────────────────────
// A persistent, session-lifetime accumulator the store folds spans into as they
// are ingested. Unlike buildServiceMap (which re-derives from a window of live
// traces), this is never pruned by trace eviction — topology and call/error
// counts only grow, satisfying the map's "never age out" contract. Latency is
// kept over a bounded rolling window so percentiles reflect recent behaviour.

export interface ServiceMapEdgeAccum {
  source: string
  target: string
  callCount: number // cumulative
  errorCount: number // cumulative
  durations: number[] // bounded rolling window of recent durations (ns)
}

// A child span whose cross-service edge cannot be resolved yet because its
// parent span (and therefore the parent's service) has not been ingested. Held
// until the parent arrives — parents (SERVER spans) commonly arrive after their
// children, so this is the normal case, not an edge case.
export interface PendingChildEdge {
  childKey: string // `${traceId}|${spanId}` (edge-dedup guard)
  childSvc: string
  isError: boolean
  durNs: number
  // The child's CLIENT-external target, if any (used when the parent turns out
  // to be same-service, mirroring buildServiceMap's attribute-edge fallback).
  external: {
    name: string
    nodeType: ServiceMapNode['nodeType']
    system?: string
  } | null
}

export interface ServiceMapAggregate {
  nodes: Map<string, ServiceMapNode>
  edges: Map<string, ServiceMapEdgeAccum> // key `${source}||${target}`
  spanService: Map<string, string> // `${traceId}|${spanId}` -> serviceName
  countedNodeSpans: Set<string> // node stats counted (dedup)
  resolvedEdgeSpans: Set<string> // edge contribution emitted (dedup)
  pendingChildren: Map<string, PendingChildEdge[]> // `${traceId}|${parentSpanId}`
}
