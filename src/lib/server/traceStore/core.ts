import type {
  ServiceMapData,
  StoredLog,
  StoredSpan,
  StoredTrace,
  TraceListItem,
  TraceStore,
} from '$lib/types'
import { buildServiceMap } from '$lib/server/serviceMap'
import { extractAnyValue, flattenAttributes } from '$lib/utils/attributes'
import { formatTimestamp, getDurationMs } from '$lib/utils/time'
import { SPAN_KIND_NAMES, STATUS_CODE_NAMES } from '$lib/utils/otlpEnums'

export interface InternalTraceStore extends TraceStore {
  listAllTraces(): StoredTrace[]
  replaceAllTraces(traces: StoredTrace[]): void
}

function isBeforeNano(a: string, b: string): boolean {
  return BigInt(a) < BigInt(b)
}

function isAfterNano(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b)
}

function normalizeSpanKind(kind: unknown): number {
  if (typeof kind === 'number') return kind
  if (typeof kind === 'string' && kind in SPAN_KIND_NAMES)
    return SPAN_KIND_NAMES[kind]
  return 0
}

function normalizeStatusCode(code: unknown): number {
  if (typeof code === 'number') return code
  if (typeof code === 'string' && code in STATUS_CODE_NAMES)
    return STATUS_CODE_NAMES[code]
  return 0
}

function getLogTimestamp(logRecord: any): string {
  return logRecord.timeUnixNano || logRecord.observedTimeUnixNano || ''
}

export function createLogId(logRecord: any, index: number): string {
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

export function createInternalTraceStore(
  maxTraces: number,
): InternalTraceStore {
  const traces = new Map<string, StoredTrace>()
  const listeners = new Set<() => void>()

  function notifyListeners() {
    for (const listener of listeners) {
      listener()
    }
  }

  function evictOverflow() {
    while (traces.size > maxTraces) {
      const oldestTraceId = traces.keys().next().value
      if (!oldestTraceId) break
      traces.delete(oldestTraceId)
    }
  }

  function ingest(resourceSpans: any[]): void {
    if (!resourceSpans || !Array.isArray(resourceSpans)) {
      return
    }

    for (const rs of resourceSpans) {
      const resourceAttrs = flattenAttributes(rs.resource?.attributes)
      const serviceName = (resourceAttrs['service.name'] as string) || 'unknown'

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
            evictOverflow()
          }

          const storedSpan: StoredSpan = {
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId || '',
            name: span.name || '',
            kind: normalizeSpanKind(span.kind),
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
              code: normalizeStatusCode(span.status?.code),
              message: span.status?.message || '',
            },
            resource: resourceAttrs,
            scopeName,
            scopeVersion,
            scopeAttributes,
          }

          trace.spans.set(span.spanId, storedSpan)
          trace.updatedAt = now
          trace.spanCount = trace.spans.size
          trace.rootSpanName = resolveRootSpanName(trace)

          if (isBeforeNano(span.startTimeUnixNano, trace.startTimeUnixNano)) {
            trace.startTimeUnixNano = span.startTimeUnixNano
          }
          if (isAfterNano(span.endTimeUnixNano, trace.endTimeUnixNano)) {
            trace.endTimeUnixNano = span.endTimeUnixNano
          }

          if (storedSpan.status.code === 2) {
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
            evictOverflow()
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

  function getTraceList(limit = 100): TraceListItem[] {
    const traceArray = Array.from(traces.values())

    traceArray.sort((a, b) => {
      const aBigInt = BigInt(b.startTimeUnixNano)
      const bBigInt = BigInt(a.startTimeUnixNano)
      return aBigInt > bBigInt ? 1 : aBigInt < bBigInt ? -1 : 0
    })

    return traceArray.slice(0, limit).map((trace) => ({
      traceId: trace.traceId,
      rootSpanName: resolveRootSpanName(trace),
      rootSpanTentative: !Array.from(trace.spans.values()).some(
        (s) => !s.parentSpanId || s.parentSpanId === '',
      ),
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

  function deleteTraces(traceIds: string[]): number {
    if (!Array.isArray(traceIds) || traceIds.length === 0) {
      return 0
    }

    let deletedCount = 0
    for (const traceId of traceIds) {
      if (traces.delete(traceId)) {
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      notifyListeners()
    }

    return deletedCount
  }

  function subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  function listAllTraces(): StoredTrace[] {
    return Array.from(traces.values())
  }

  function replaceAllTraces(nextTraces: StoredTrace[]): void {
    traces.clear()
    for (const trace of nextTraces) {
      traces.set(trace.traceId, trace)
    }
    evictOverflow()
    notifyListeners()
  }

  return {
    ingest,
    ingestLogs,
    getTraceList,
    getTrace,
    getServiceMap,
    clear,
    deleteTraces,
    subscribe,
    listAllTraces,
    replaceAllTraces,
    get maxTraces() {
      return maxTraces
    },
  }
}
