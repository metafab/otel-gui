// Server-side in-memory trace store
import type {
  TraceStore,
  StoredTrace,
  StoredSpan,
  StoredLog,
  TraceListItem,
  ServiceMapData,
} from '$lib/types'
import { extractAnyValue, flattenAttributes } from '$lib/utils/attributes'
import { formatTimestamp, getDurationMs } from '$lib/utils/time'
import { buildServiceMap } from '$lib/server/serviceMap'
import { env } from '$env/dynamic/private'

// In-memory storage (persists across requests with adapter-node)
const traces = new Map<string, StoredTrace>()
const listeners = new Set<() => void>()

function resolveMaxTraces(): number {
  const raw = env.OTEL_GUI_MAX_TRACES
  if (raw === undefined || raw === '') return 1000
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 10_000) {
    console.warn(
      `[otel-gui] Invalid OTEL_GUI_MAX_TRACES="${raw}". Must be an integer between 1 and 10000. Falling back to 1000.`,
    )
    return 1000
  }
  return parsed
}

const MAX_TRACES = resolveMaxTraces()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function isBeforeNano(a: string, b: string): boolean {
  return BigInt(a) < BigInt(b)
}

function isAfterNano(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b)
}

function getLogTimestamp(logRecord: any): string {
  return logRecord.timeUnixNano || logRecord.observedTimeUnixNano || ''
}

function createLogId(logRecord: any, index: number): string {
  const traceId = logRecord.traceId || ''
  const spanId = logRecord.spanId || ''
  const timeUnixNano = logRecord.timeUnixNano || ''
  const observedTimeUnixNano = logRecord.observedTimeUnixNano || ''
  const severityText = logRecord.severityText || ''
  const body = extractAnyValue(logRecord.body)
  const bodyPart =
    typeof body === 'string' ||
    typeof body === 'number' ||
    typeof body === 'boolean'
      ? String(body)
      : ''
  return [
    traceId,
    spanId,
    timeUnixNano,
    observedTimeUnixNano,
    severityText,
    bodyPart,
    String(index),
  ].join(':')
}

function ingest(resourceSpans: any[]): void {
  if (!resourceSpans || !Array.isArray(resourceSpans)) {
    return
  }

  for (const rs of resourceSpans) {
    // Extract resource attributes (service.name, etc.)
    const resourceAttrs = flattenAttributes(rs.resource?.attributes)
    const serviceName = (resourceAttrs['service.name'] as string) || 'unknown'

    // Process all scope spans
    const scopeSpansList = rs.scopeSpans || []
    for (const ss of scopeSpansList) {
      const scopeName = ss.scope?.name || ''
      const scopeVersion = ss.scope?.version || ''
      const scopeAttributes = flattenAttributes(ss.scope?.attributes)
      const spans = ss.spans || []
      for (const span of spans) {
        const traceId = span.traceId
        if (!traceId) continue
        const now = Date.now()

        // Get or create trace
        let trace = traces.get(traceId)
        if (!trace) {
          trace = {
            traceId,
            rootSpanName: '',
            serviceName,
            startTimeUnixNano: span.startTimeUnixNano,
            endTimeUnixNano: span.endTimeUnixNano,
            updatedAt: now,
            spanCount: 0,
            hasError: false,
            spans: new Map(),
          }
          traces.set(traceId, trace)

          // Evict oldest trace if we exceed max
          if (traces.size > MAX_TRACES) {
            const oldestTraceId = traces.keys().next().value
            if (oldestTraceId) {
              traces.delete(oldestTraceId)
            }
          }
        }

        // Create stored span
        const storedSpan: StoredSpan = {
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || '',
          name: span.name || '',
          kind: span.kind || 0,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: flattenAttributes(span.attributes),
          events: (span.events || []).map((e: any) => ({
            timeUnixNano: e.timeUnixNano,
            name: e.name || '',
            attributes: flattenAttributes(e.attributes),
          })),
          links: (span.links || []).map((l: any) => ({
            traceId: l.traceId,
            spanId: l.spanId,
            traceState: l.traceState || '',
            attributes: flattenAttributes(l.attributes),
          })),
          status: {
            code: span.status?.code || 0,
            message: span.status?.message || '',
          },
          resource: resourceAttrs,
          scopeName,
          scopeVersion,
          scopeAttributes,
        }

        // Add span to trace
        trace.spans.set(span.spanId, storedSpan)
        trace.updatedAt = now

        // Update trace metadata
        trace.spanCount = trace.spans.size

        // Update root span name (span with no parent)
        if (!storedSpan.parentSpanId || storedSpan.parentSpanId === '') {
          trace.rootSpanName = storedSpan.name
        }

        // Update trace time range
        if (isBeforeNano(span.startTimeUnixNano, trace.startTimeUnixNano)) {
          trace.startTimeUnixNano = span.startTimeUnixNano
        }
        if (isAfterNano(span.endTimeUnixNano, trace.endTimeUnixNano)) {
          trace.endTimeUnixNano = span.endTimeUnixNano
        }

        // Check for errors
        if (storedSpan.status.code === 2) {
          trace.hasError = true
        }

        // Use first seen service name if not set
        if (trace.serviceName === 'unknown' && serviceName !== 'unknown') {
          trace.serviceName = serviceName
        }
      }
    }
  }

  notifyListeners()
}

function ingestLogs(resourceLogs: any[]): void {
  if (!resourceLogs || !Array.isArray(resourceLogs)) {
    return
  }

  for (const rl of resourceLogs) {
    const resourceAttrs = flattenAttributes(rl.resource?.attributes)
    const serviceName = (resourceAttrs['service.name'] as string) || 'unknown'

    const scopeLogsList = rl.scopeLogs || []
    for (const sl of scopeLogsList) {
      const scopeName = sl.scope?.name || ''
      const scopeVersion = sl.scope?.version || ''
      const scopeAttributes = flattenAttributes(sl.scope?.attributes)
      const logRecords = sl.logRecords || []

      for (const [index, logRecord] of logRecords.entries()) {
        const traceId = logRecord.traceId
        if (!traceId) continue

        const now = Date.now()
        const timestamp = getLogTimestamp(logRecord)
        if (!timestamp) continue

        let trace = traces.get(traceId)
        if (!trace) {
          trace = {
            traceId,
            rootSpanName: 'unknown',
            serviceName,
            startTimeUnixNano: timestamp,
            endTimeUnixNano: timestamp,
            updatedAt: now,
            spanCount: 0,
            hasError: false,
            spans: new Map(),
            logs: new Map(),
            logCount: 0,
          }
          traces.set(traceId, trace)

          if (traces.size > MAX_TRACES) {
            const oldestTraceId = traces.keys().next().value
            if (oldestTraceId) {
              traces.delete(oldestTraceId)
            }
          }
        }

        if (!trace.logs) {
          trace.logs = new Map()
        }

        const storedLog: StoredLog = {
          traceId,
          spanId: logRecord.spanId || '',
          timeUnixNano: logRecord.timeUnixNano || '',
          observedTimeUnixNano: logRecord.observedTimeUnixNano || '',
          severityNumber:
            typeof logRecord.severityNumber === 'number'
              ? logRecord.severityNumber
              : Number(logRecord.severityNumber) || 0,
          severityText: logRecord.severityText || '',
          body: extractAnyValue(logRecord.body),
          attributes: flattenAttributes(logRecord.attributes),
          resource: resourceAttrs,
          scopeName,
          scopeVersion,
          scopeAttributes,
        }

        const logId = createLogId(logRecord, index)
        trace.logs.set(logId, storedLog)
        trace.logCount = trace.logs.size
        trace.updatedAt = now

        if (isBeforeNano(timestamp, trace.startTimeUnixNano)) {
          trace.startTimeUnixNano = timestamp
        }
        if (isAfterNano(timestamp, trace.endTimeUnixNano)) {
          trace.endTimeUnixNano = timestamp
        }

        if (storedLog.severityNumber >= 17) {
          trace.hasError = true
        }

        if (trace.serviceName === 'unknown' && serviceName !== 'unknown') {
          trace.serviceName = serviceName
        }
      }
    }
  }

  notifyListeners()
}

// Find the effective root span name for a trace.
// Tries true root (no parentSpanId) first, then falls back to the earliest
// orphan — a span whose parent is not present in this trace (typical in
// multi-service traces where the gateway root arrives in a separate batch
// or was never instrumented).
export function resolveRootSpanName(trace: StoredTrace): string {
  const spans = Array.from(trace.spans.values())
  let rootSpan = spans.find((s) => !s.parentSpanId || s.parentSpanId === '')
  if (!rootSpan) {
    const orphans = spans.filter((s) => !trace.spans.has(s.parentSpanId))
    if (orphans.length > 0) {
      orphans.sort((a, b) =>
        BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1,
      )
      rootSpan = orphans[0]
    }
  }
  return rootSpan?.name || 'unknown'
}

function getTraceList(limit = 100): TraceListItem[] {
  const traceArray = Array.from(traces.values())

  // Sort by start time descending (newest first)
  traceArray.sort((a, b) => {
    const aBigInt = BigInt(b.startTimeUnixNano)
    const bBigInt = BigInt(a.startTimeUnixNano)
    return aBigInt > bBigInt ? 1 : aBigInt < bBigInt ? -1 : 0
  })

  return traceArray.slice(0, limit).map((trace) => ({
    traceId: trace.traceId,
    rootSpanName: resolveRootSpanName(trace),
    serviceName: trace.serviceName,
    durationMs: getDurationMs(trace.startTimeUnixNano, trace.endTimeUnixNano),
    spanCount: trace.spanCount,
    hasError: trace.hasError,
    startTime: formatTimestamp(trace.startTimeUnixNano),
    updatedAt: trace.updatedAt,
  }))
}

function getTrace(traceId: string): StoredTrace | undefined {
  return traces.get(traceId)
}

function getServiceMap(filterTraceId?: string): ServiceMapData {
  const tracesToProcess = filterTraceId
    ? ([traces.get(filterTraceId)].filter(Boolean) as StoredTrace[])
    : Array.from(traces.values())
  return buildServiceMap(tracesToProcess)
}

function clear(): void {
  traces.clear()
  notifyListeners()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// Export the store instance
export const traceStore: TraceStore = {
  ingest,
  ingestLogs,
  getTraceList,
  getTrace,
  getServiceMap,
  clear,
  subscribe,
  get maxTraces() {
    return MAX_TRACES
  },
}
