// OTLP Trace Data Types

// Shared types — canonical source is @otel-gui/core
import type { StoredLog, StoredSpan, StoredTrace, ServiceMapData } from '@otel-gui/core'

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

export interface TraceLogListItem {
  id: string
  traceId: string
  spanId: string
  timeUnixNano: string
  observedTimeUnixNano: string
  severityNumber: number
  severityText: string
  body: unknown
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
  ingest(resourceSpans: any[]): void
  ingestLogs(resourceLogs: any[]): void
  getTraceList(limit?: number): TraceListItem[]
  getTrace(traceId: string): StoredTrace | undefined
  getServiceMap(traceId?: string): ServiceMapData
  clear(): void
  deleteTraces(traceIds: string[]): number
  subscribe(fn: () => void): () => void
  readonly maxTraces: number
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
