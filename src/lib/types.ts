// OTLP Trace Data Types

// Shared types — canonical source is @otel-gui/core
import type {
  StoredLog,
  StoredSpan,
  StoredTrace,
  ServiceMapData,
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

  // Trace writes
  clearTraces(): void
  deleteTraces(traceIds: string[]): number

  // Log reads
  getLogCount(): number
  getLogList(limit?: number): LogListItem[]
  getTraceLogs(traceId: string, limit?: number): LogListItem[]
  getLog(logId: string): TraceLogDetail | undefined

  // Log writes
  clearLogs(): void
  deleteLogs(logIds: string[]): number

  // Infrastructure
  subscribe(fn: () => void): () => void
  readonly maxTraces: number
  readonly maxLogs: number
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
