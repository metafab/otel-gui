// OTLP Trace Data Types

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
  startTimeUnixNano: string // string to preserve precision
  endTimeUnixNano: string
  attributes: Record<string, any> // flattened from KeyValue[]
  events: SpanEvent[]
  links: SpanLink[]
  status: SpanStatus
  resource: Record<string, any> // flattened resource attributes
  scopeName: string
  scopeVersion: string
  scopeAttributes: Record<string, any> // flattened scope attributes
}

export interface StoredTrace {
  traceId: string
  rootSpanName: string
  serviceName: string // from resource service.name
  startTimeUnixNano: string // earliest span start
  endTimeUnixNano: string // latest span end
  updatedAt: number // epoch ms, bumped whenever this trace is modified
  spanCount: number
  hasError: boolean // any span with status.code === 2
  spans: Map<string, StoredSpan>
  logs?: Map<string, StoredLog>
  logCount?: number
}

export interface TraceListItem {
  traceId: string
  rootSpanName: string
  serviceName: string
  durationMs: number
  spanCount: number
  hasError: boolean
  startTime: string // ISO timestamp for display
  updatedAt: number // epoch ms, copied from StoredTrace
}

// Service map types
export interface ServiceMapNode {
  serviceName: string
  spanCount: number
  errorCount: number
  /** Detected system type: 'service' | 'database' | 'messaging' | 'rpc' */
  nodeType: 'service' | 'database' | 'messaging' | 'rpc'
  /** For external nodes: db.system / messaging.system value */
  system?: string
}

export interface ServiceMapEdge {
  source: string // caller service name
  target: string // callee service/system name
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

// Swappable storage interface
export interface TraceStore {
  ingest(resourceSpans: any[]): void
  ingestLogs(resourceLogs: any[]): void
  getTraceList(limit?: number): TraceListItem[]
  getTrace(traceId: string): StoredTrace | undefined
  getServiceMap(traceId?: string): ServiceMapData
  clear(): void
  subscribe(fn: () => void): () => void
}

// Span tree node for waterfall rendering
export interface SpanTreeNode {
  span: StoredSpan
  depth: number
  children: SpanTreeNode[]
  collapsed: boolean
  /** Total number of descendant spans (direct + indirect). 0 for leaf nodes. */
  subtreeSize: number
}
