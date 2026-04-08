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
