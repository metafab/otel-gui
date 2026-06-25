import type {
  LogListItem,
  MetricListItem,
  MetricDetail,
  MetricSeries,
  MetricSeriesDetail,
  MetricWirePoint,
  MetricPoint,
  HistogramPoint,
  ExpHistogramPoint,
  SummaryPoint,
  SummaryQuantile,
  MetricTemporality,
  MetricType,
  ServiceMapData,
  StoredLog,
  StoredMetric,
  StoredSpan,
  StoredTrace,
  TraceListItem,
  TraceStore,
} from '$lib/types'
import { buildServiceMap } from '@otel-gui/core'
import { extractAnyValue, flattenAttributes } from '@otel-gui/core'
import { formatTimestamp, getDurationMs } from '$lib/utils/time'
import { SPAN_KIND_NAMES, STATUS_CODE_NAMES } from '$lib/utils/otlpEnums'
import {
  createLogId,
  createMetricKey,
  createSeriesId,
  resolveRootServiceName,
  resolveRootSpanName,
} from '@otel-gui/core'

// Number of trailing series values projected into a MetricListItem sparkline.
const SPARKLINE_POINTS = 30

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

// OTLP AggregationTemporality: 1 = DELTA, 2 = CUMULATIVE. Decoders may emit
// either the numeric enum or the ProtoJSON string name, so normalize both.
function normalizeTemporality(raw: unknown): MetricTemporality | undefined {
  if (raw === 1 || raw === 'AGGREGATION_TEMPORALITY_DELTA') return 'delta'
  if (raw === 2 || raw === 'AGGREGATION_TEMPORALITY_CUMULATIVE')
    return 'cumulative'
  return undefined
}

// NumberDataPoint value is a oneof: as_double (double) or as_int (int64,
// string-encoded in JSON). Returns undefined when neither is present.
function extractDataPointValue(point: any): number | undefined {
  if (point.asDouble !== undefined && point.asDouble !== null) {
    return Number(point.asDouble)
  }
  if (point.asInt !== undefined && point.asInt !== null) {
    return Number(point.asInt)
  }
  return undefined
}

// timeUnixNano is nanoseconds since epoch; convert to epoch ms for charting.
function nanoToEpochMs(timeUnixNano: unknown): number | undefined {
  if (timeUnixNano === undefined || timeUnixNano === null) return undefined
  const asNumber = Number(timeUnixNano)
  if (!Number.isFinite(asNumber) || asNumber <= 0) return undefined
  return Math.floor(asNumber / 1_000_000)
}

export function createInternalTraceStore(
  maxTraces: number,
  maxLogs: number,
  maxMetrics = 1000,
  maxMetricPoints = 600,
): InternalTraceStore {
  const traces = new Map<string, StoredTrace>()
  const logs = new Map<string, StoredLog>()
  const traceLogCounts = new Map<string, number>()
  const logTraceIdByLogId = new Map<string, string>()
  const listeners = new Set<() => void>()

  // Monotonic insertion sequence per log, used for incremental SSE delta
  // streaming (clients pull only logs newer than the last seq they saw).
  const logSeqById = new Map<string, number>()
  let logSeq = 0
  // Bumped whenever logs are explicitly removed (clear/delete) — distinct from
  // eviction, which clients mirror locally. Signals subscribers to re-snapshot.
  let logRemovalSeq = 0

  // Metrics state. Keyed by createMetricKey(serviceName, name); each metric
  // holds a Map of series (attribute fingerprint -> time-ordered point ring).
  const metrics = new Map<string, StoredMetric>()
  // Per-metric monotonic sequence, used as the SSE delta cursor (clients pull
  // only metrics touched after the last seq they saw).
  const metricSeqById = new Map<string, number>()
  let metricSeq = 0
  // Bumped on explicit clear/delete (not eviction); signals subscribers to
  // re-snapshot the list rather than append.
  let metricRemovalSeq = 0

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

  function setTraceLogCount(traceId: string) {
    const trace = traces.get(traceId)
    if (!trace) return
    trace.logCount = traceLogCounts.get(traceId) || 0
  }

  function incrementTraceLogCount(traceId: string) {
    if (!traceId) return
    traceLogCounts.set(traceId, (traceLogCounts.get(traceId) || 0) + 1)
    setTraceLogCount(traceId)
  }

  function decrementTraceLogCount(traceId: string) {
    if (!traceId) return
    const next = (traceLogCounts.get(traceId) || 0) - 1
    if (next > 0) {
      traceLogCounts.set(traceId, next)
    } else {
      traceLogCounts.delete(traceId)
    }
    setTraceLogCount(traceId)
  }

  function ingestSpans(resourceSpans: any[]): void {
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
              logCount: traceLogCounts.get(traceId) || 0,
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

          const rootServiceName = resolveRootServiceName(trace)
          if (rootServiceName !== 'unknown') {
            trace.serviceName = rootServiceName
          }

          if (isBeforeNano(span.startTimeUnixNano, trace.startTimeUnixNano)) {
            trace.startTimeUnixNano = span.startTimeUnixNano
          }
          if (isAfterNano(span.endTimeUnixNano, trace.endTimeUnixNano)) {
            trace.endTimeUnixNano = span.endTimeUnixNano
          }

          if (storedSpan.status.code === 2) {
            trace.hasError = true
          }

          if (
            trace.serviceName === 'unknown' &&
            rootServiceName === 'unknown' &&
            serviceName !== 'unknown'
          ) {
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
          const traceId = logRecord.traceId || ''
          const now = Date.now()
          const timestamp = getLogTimestamp(logRecord)
          if (!timestamp) continue

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

          const previousTraceId = logTraceIdByLogId.get(logId)
          if (previousTraceId) {
            decrementTraceLogCount(previousTraceId)
            logTraceIdByLogId.delete(logId)
          }

          logs.set(logId, storedLog)
          logSeqById.set(logId, ++logSeq)

          if (traceId) {
            logTraceIdByLogId.set(logId, traceId)
            incrementTraceLogCount(traceId)
          }

          if (logs.size > maxLogs) {
            const oldestId = logs.keys().next().value
            if (oldestId) {
              logs.delete(oldestId)
              logSeqById.delete(oldestId)
              const evictedTraceId = logTraceIdByLogId.get(oldestId)
              if (evictedTraceId) {
                decrementTraceLogCount(evictedTraceId)
                logTraceIdByLogId.delete(oldestId)
              }
            }
          }

          if (!traceId) continue

          // Ensure a trace shell exists and update its metadata
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
              logCount: traceLogCounts.get(traceId) || 0,
              spans: new Map(),
            }
            traces.set(traceId, trace)
            evictOverflow()
          }

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
      serviceName:
        resolveRootServiceName(trace) === 'unknown'
          ? trace.serviceName
          : resolveRootServiceName(trace),
      traceId: trace.traceId,
      rootSpanName: resolveRootSpanName(trace),
      rootSpanTentative: !Array.from(trace.spans.values()).some(
        (s) => !s.parentSpanId || s.parentSpanId === '',
      ),
      durationMs: getDurationMs(trace.startTimeUnixNano, trace.endTimeUnixNano),
      spanCount: trace.spanCount,
      logCount: traceLogCounts.get(trace.traceId) ?? trace.logCount ?? 0,
      hasError: trace.hasError,
      startTime: formatTimestamp(trace.startTimeUnixNano),
      updatedAt: trace.updatedAt,
    }))
  }

  function getTraceCount(): number {
    return traces.size
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

  function clearTraces(): void {
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

  function toLogListItem(id: string, log: StoredLog): LogListItem {
    return {
      id,
      traceId: log.traceId || null,
      spanId: log.spanId || null,
      timeUnixNano: log.timeUnixNano,
      observedTimeUnixNano: log.observedTimeUnixNano,
      severityNumber: log.severityNumber,
      severityText: log.severityText,
      body: log.body,
      serviceName: (log.resource['service.name'] as string) || 'unknown',
    }
  }

  function compareLogsByTimeDesc(a: StoredLog, b: StoredLog): number {
    const aTs = BigInt(a.timeUnixNano || a.observedTimeUnixNano || '0')
    const bTs = BigInt(b.timeUnixNano || b.observedTimeUnixNano || '0')
    return bTs > aTs ? 1 : bTs < aTs ? -1 : 0
  }

  function getLogList(limit = 500): LogListItem[] {
    const all = Array.from(logs.entries())

    all.sort(([, a], [, b]) => compareLogsByTimeDesc(a, b))

    return all.slice(0, limit).map(([id, log]) => toLogListItem(id, log))
  }

  function getLogCount(): number {
    return logs.size
  }

  // Newest sequence number assigned so far. Clients track this as a cursor and
  // ask getLogsSince() for everything ingested after it.
  function getMaxLogSeq(): number {
    return logSeq
  }

  // Incremented on explicit clear/delete (not eviction); lets SSE subscribers
  // tell "new logs arrived" (append) apart from "logs removed" (re-snapshot).
  function getLogRemovalSeq(): number {
    return logRemovalSeq
  }

  // Logs ingested after `afterSeq`, newest-first, capped at `limit`. Used to
  // stream incremental deltas instead of re-sending the whole list.
  function getLogsSince(afterSeq: number, limit = 5000): LogListItem[] {
    const fresh: Array<[string, StoredLog]> = []
    for (const [id, log] of logs) {
      const seq = logSeqById.get(id)
      if (seq !== undefined && seq > afterSeq) {
        fresh.push([id, log])
      }
    }

    fresh.sort(([, a], [, b]) => compareLogsByTimeDesc(a, b))

    return fresh.slice(0, limit).map(([id, log]) => toLogListItem(id, log))
  }

  function getTraceLogs(traceId: string, limit = 100): LogListItem[] {
    const entries = Array.from(logs.entries()).filter(
      ([, log]) => log.traceId === traceId,
    )

    entries.sort(([, a], [, b]) => compareLogsByTimeDesc(a, b))

    return entries.slice(0, limit).map(([id, log]) => toLogListItem(id, log))
  }

  function getLog(logId: string) {
    const log = logs.get(logId)
    if (!log) return undefined
    return { id: logId, ...log }
  }

  function clearLogs(): void {
    logs.clear()
    logSeqById.clear()
    logTraceIdByLogId.clear()
    traceLogCounts.clear()
    logRemovalSeq++
    for (const trace of traces.values()) {
      trace.logCount = 0
    }
    notifyListeners()
  }

  function deleteLogs(logIds: string[]): number {
    if (!Array.isArray(logIds) || logIds.length === 0) return 0

    let deleted = 0
    for (const id of logIds) {
      if (logs.delete(id)) {
        deleted++
        logSeqById.delete(id)
        const traceId = logTraceIdByLogId.get(id)
        if (traceId) {
          decrementTraceLogCount(traceId)
          logTraceIdByLogId.delete(id)
        }
      }
    }

    if (deleted > 0) {
      logRemovalSeq++
      notifyListeners()
    }
    return deleted
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  function detectMetricType(metric: any): {
    type: MetricType
    data: any
  } | null {
    // protobufjs sets a `data` discriminator (the populated oneof name) when
    // decoded with oneofs: true; OTLP/JSON simply has the member key present.
    if (metric.gauge) return { type: 'gauge', data: metric.gauge }
    if (metric.sum) return { type: 'sum', data: metric.sum }
    if (metric.histogram) return { type: 'histogram', data: metric.histogram }
    if (metric.exponentialHistogram)
      return { type: 'exp_histogram', data: metric.exponentialHistogram }
    if (metric.summary) return { type: 'summary', data: metric.summary }
    return null
  }

  // Coerce an int64-or-double-or-string OTLP scalar to a finite number, or
  // undefined. bucketCounts/count arrive as JSON strings (int64) or numbers.
  function toFiniteNumber(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

  function toCountArray(raw: unknown): number[] {
    if (!Array.isArray(raw)) return []
    return raw.map((c) => toFiniteNumber(c) ?? 0)
  }

  // Build the per-type point for one OTLP data point. Returns null when the
  // point is unusable (no usable timestamp, etc.).
  function buildMetricPoint(
    type: MetricType,
    point: any,
    t: number,
  ): MetricPoint | HistogramPoint | ExpHistogramPoint | SummaryPoint | null {
    if (type === 'gauge' || type === 'sum') {
      const value = extractDataPointValue(point)
      if (value === undefined || !Number.isFinite(value)) return null
      return { t, v: value }
    }

    if (type === 'histogram') {
      const hp: HistogramPoint = {
        t,
        count: toFiniteNumber(point.count) ?? 0,
        bucketCounts: toCountArray(point.bucketCounts),
        explicitBounds: Array.isArray(point.explicitBounds)
          ? point.explicitBounds.map((b: unknown) => Number(b))
          : [],
      }
      const sum = toFiniteNumber(point.sum)
      if (sum !== undefined) hp.sum = sum
      const min = toFiniteNumber(point.min)
      if (min !== undefined) hp.min = min
      const max = toFiniteNumber(point.max)
      if (max !== undefined) hp.max = max
      return hp
    }

    if (type === 'exp_histogram') {
      const ep: ExpHistogramPoint = {
        t,
        count: toFiniteNumber(point.count) ?? 0,
        scale: toFiniteNumber(point.scale) ?? 0,
        zeroCount: toFiniteNumber(point.zeroCount) ?? 0,
        positive: {
          offset: toFiniteNumber(point.positive?.offset) ?? 0,
          bucketCounts: toCountArray(point.positive?.bucketCounts),
        },
        negative: {
          offset: toFiniteNumber(point.negative?.offset) ?? 0,
          bucketCounts: toCountArray(point.negative?.bucketCounts),
        },
      }
      const sum = toFiniteNumber(point.sum)
      if (sum !== undefined) ep.sum = sum
      const min = toFiniteNumber(point.min)
      if (min !== undefined) ep.min = min
      const max = toFiniteNumber(point.max)
      if (max !== undefined) ep.max = max
      return ep
    }

    // summary
    const quantileValues: SummaryQuantile[] = Array.isArray(
      point.quantileValues,
    )
      ? point.quantileValues.map((q: any) => ({
          quantile: toFiniteNumber(q.quantile) ?? 0,
          value: toFiniteNumber(q.value) ?? 0,
        }))
      : []
    return {
      t,
      count: toFiniteNumber(point.count) ?? 0,
      sum: toFiniteNumber(point.sum) ?? 0,
      quantileValues,
    }
  }

  function ingestMetrics(resourceMetrics: any[]): void {
    if (!resourceMetrics || !Array.isArray(resourceMetrics)) {
      return
    }

    let touched = false

    for (const rm of resourceMetrics) {
      const resourceAttrs = flattenAttributes(rm.resource?.attributes)
      const serviceName = (resourceAttrs['service.name'] as string) || 'unknown'

      const scopeMetricsList = rm.scopeMetrics || []
      for (const sm of scopeMetricsList) {
        const metricList = sm.metrics || []
        for (const metric of metricList) {
          const detected = detectMetricType(metric)
          if (!detected) continue // unknown/empty oneof

          const { type, data } = detected
          const name = metric.name || ''
          const key = createMetricKey(serviceName, name)
          const now = Date.now()

          let stored = metrics.get(key)
          if (!stored) {
            stored = {
              name,
              description: metric.description || '',
              unit: metric.unit || '',
              type,
              serviceName,
              series: new Map<string, MetricSeries>(),
              lastUpdated: now,
            }
            metrics.set(key, stored)
          } else {
            stored.description = metric.description || stored.description
            stored.unit = metric.unit || stored.unit
            stored.type = type
          }

          if (type === 'sum') {
            const temporality = normalizeTemporality(data.aggregationTemporality)
            if (temporality) stored.temporality = temporality
            stored.isMonotonic = data.isMonotonic === true
          } else if (type === 'histogram' || type === 'exp_histogram') {
            const temporality = normalizeTemporality(data.aggregationTemporality)
            if (temporality) stored.temporality = temporality
          }

          const dataPoints = data.dataPoints || []
          for (const point of dataPoints) {
            const t = nanoToEpochMs(point.timeUnixNano)
            if (t === undefined) continue

            const built = buildMetricPoint(type, point, t)
            if (built === null) continue

            const attributes = flattenAttributes(point.attributes)
            const seriesId = createSeriesId(attributes)

            let series = stored.series.get(seriesId)
            if (!series) {
              series = { seriesId, attributes, points: [] }
              stored.series.set(seriesId, series)
            }

            // points is a typed union keyed by metric type; the push is
            // type-correct by construction (buildMetricPoint matched `type`).
            ;(series.points as Array<typeof built>).push(built)
            // Trim oldest points beyond the per-series retention bound.
            if (series.points.length > maxMetricPoints) {
              series.points.splice(0, series.points.length - maxMetricPoints)
            }

            stored.lastUpdated = now
          }

          metricSeqById.set(key, ++metricSeq)
          touched = true
        }
      }
    }

    // Evict whole metrics (oldest by insertion) once over the series cap.
    while (metrics.size > maxMetrics) {
      const oldestKey = metrics.keys().next().value
      if (!oldestKey) break
      metrics.delete(oldestKey)
      metricSeqById.delete(oldestKey)
    }

    if (touched) {
      notifyListeners()
    }
  }

  function busiestSeries(metric: StoredMetric): MetricSeries | undefined {
    let best: MetricSeries | undefined
    for (const series of metric.series.values()) {
      if (!best || series.points.length > best.points.length) {
        best = series
      }
    }
    return best
  }

  // Project a sparkline value out of a point regardless of metric type:
  // gauge/sum -> raw value; histogram/exp_histogram/summary -> count (a
  // meaningful "how busy" proxy). Never throws on the richer point shapes.
  function sparkValue(type: MetricType, point: any): number {
    if (type === 'gauge' || type === 'sum') return Number(point.v) || 0
    // histogram / exp_histogram / summary all carry `count`.
    return Number(point.count) || 0
  }

  function toMetricListItem(id: string, metric: StoredMetric): MetricListItem {
    const series = busiestSeries(metric)
    const points: any[] = series?.points ?? []
    const sparkline = points
      .slice(Math.max(0, points.length - SPARKLINE_POINTS))
      .map((p) => sparkValue(metric.type, p))

    return {
      id,
      name: metric.name,
      type: metric.type,
      unit: metric.unit,
      serviceName: metric.serviceName,
      seriesCount: metric.series.size,
      lastUpdated: metric.lastUpdated,
      sparkline,
    }
  }

  function compareMetricsByUpdatedDesc(
    a: StoredMetric,
    b: StoredMetric,
  ): number {
    return b.lastUpdated - a.lastUpdated
  }

  function getMetricCount(): number {
    return metrics.size
  }

  function getMetricList(limit = 500): MetricListItem[] {
    const all = Array.from(metrics.entries())
    all.sort(([, a], [, b]) => compareMetricsByUpdatedDesc(a, b))
    return all.slice(0, limit).map(([id, metric]) => toMetricListItem(id, metric))
  }

  function getMetric(id: string): StoredMetric | undefined {
    return metrics.get(id)
  }

  // ─── Rate computation (server-side) ────────────────────────────────────────
  //
  // For Sum metrics we attach a per-second `rate` to each point (except the
  // first of a series, which has no predecessor). For cumulative sums:
  //   rate(p_i) = (v_i − v_{i-1}) / ((t_i − t_{i-1}) / 1000)
  // with counter-reset detection: if v_i < v_{i-1} the counter restarted, so we
  // emit v_i / Δt (assume the previous baseline was 0) rather than a negative
  // spike. Delta sums are already per-interval, so the rate is simply
  // v_i / Δt. Points with Δt <= 0 (duplicate/out-of-order timestamps) get no
  // rate. Gauges and the histogram/exp/summary families pass through unchanged.
  function projectSumPoints(
    points: MetricPoint[],
    temporality: MetricTemporality | undefined,
  ): MetricWirePoint[] {
    const out: MetricWirePoint[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      if (i === 0) {
        out.push({ t: p.t, v: p.v })
        continue
      }
      const prev = points[i - 1]
      const dtSec = (p.t - prev.t) / 1000
      if (dtSec <= 0) {
        // Non-advancing timestamp — cannot compute a meaningful rate.
        out.push({ t: p.t, v: p.v })
        continue
      }
      let delta: number
      if (temporality === 'delta') {
        // Already an interval value.
        delta = p.v
      } else {
        // Cumulative (or unspecified — treat as cumulative): difference, with
        // reset detection.
        delta = p.v >= prev.v ? p.v - prev.v : p.v
      }
      out.push({ t: p.t, v: p.v, rate: delta / dtSec })
    }
    return out
  }

  function serializeMetricDetail(id: string, metric: StoredMetric): MetricDetail {
    const series: MetricSeriesDetail[] = []
    for (const s of metric.series.values()) {
      let points: MetricWirePoint[]
      if (metric.type === 'sum') {
        points = projectSumPoints(
          s.points as MetricPoint[],
          metric.temporality,
        )
      } else {
        // gauge / histogram / exp_histogram / summary pass through as stored.
        points = s.points as MetricWirePoint[]
      }
      series.push({ seriesId: s.seriesId, attributes: s.attributes, points })
    }
    return {
      id,
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      type: metric.type,
      temporality: metric.temporality,
      isMonotonic: metric.isMonotonic,
      serviceName: metric.serviceName,
      lastUpdated: metric.lastUpdated,
      series,
    }
  }

  // Wire-ready detail projection: flattened series with type-appropriate points
  // and (for sums) a server-computed per-second `rate` on each point. Used by
  // the detail GET + SSE endpoints. Returns undefined if the metric is gone.
  function getMetricDetail(id: string): MetricDetail | undefined {
    const metric = metrics.get(id)
    if (!metric) return undefined
    return serializeMetricDetail(id, metric)
  }

  // Newest metric sequence assigned so far; clients track this as a cursor.
  function getMaxMetricSeq(): number {
    return metricSeq
  }

  // Incremented on explicit clear/delete (not eviction); lets SSE subscribers
  // tell "metrics changed" (append) apart from "metrics removed" (re-snapshot).
  function getMetricRemovalSeq(): number {
    return metricRemovalSeq
  }

  // Metrics touched after `afterSeq`, newest-first, capped at `limit`.
  function getMetricsSince(afterSeq: number, limit = 5000): MetricListItem[] {
    const fresh: Array<[string, StoredMetric]> = []
    for (const [id, metric] of metrics) {
      const seq = metricSeqById.get(id)
      if (seq !== undefined && seq > afterSeq) {
        fresh.push([id, metric])
      }
    }

    fresh.sort(([, a], [, b]) => compareMetricsByUpdatedDesc(a, b))

    return fresh
      .slice(0, limit)
      .map(([id, metric]) => toMetricListItem(id, metric))
  }

  function clearMetrics(): void {
    metrics.clear()
    metricSeqById.clear()
    metricRemovalSeq++
    notifyListeners()
  }

  function deleteMetrics(ids: string[]): number {
    if (!Array.isArray(ids) || ids.length === 0) return 0

    let deleted = 0
    for (const id of ids) {
      if (metrics.delete(id)) {
        deleted++
        metricSeqById.delete(id)
      }
    }

    if (deleted > 0) {
      metricRemovalSeq++
      notifyListeners()
    }
    return deleted
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
    ingestSpans,
    ingestLogs,
    getTraceList,
    getTraceCount,
    getTrace,
    getServiceMap,
    deleteTraces,
    getLogList,
    getLogCount,
    getMaxLogSeq,
    getLogRemovalSeq,
    getLogsSince,
    getTraceLogs,
    getLog,
    clearLogs,
    deleteLogs,
    clearTraces,
    ingestMetrics,
    getMetricCount,
    getMetricList,
    getMetric,
    getMetricDetail,
    getMaxMetricSeq,
    getMetricRemovalSeq,
    getMetricsSince,
    clearMetrics,
    deleteMetrics,
    subscribe,
    listAllTraces,
    replaceAllTraces,
    get maxTraces() {
      return maxTraces
    },
    get maxLogs() {
      return maxLogs
    },
    get maxMetrics() {
      return maxMetrics
    },
    get maxMetricPoints() {
      return maxMetricPoints
    },
  }
}
