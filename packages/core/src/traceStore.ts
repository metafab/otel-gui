import { extractAnyValue } from './attributes.js'
import type { StoredSpan } from './types.js'
import type { StoredTrace } from './types.js'

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

export function createMetricKey(serviceName: string, name: string): string {
  return `${serviceName} ${name}`
}

export function createSeriesId(attributes: Record<string, unknown>): string {
  // stable: sort keys, join k=v with separators; '' when no attributes
  return Object.keys(attributes)
    .sort()
    .map((k) => `${k}=${String(attributes[k])}`)
    .join(' ')
}

// Exponential-histogram bucket → value bounds.
//
// Per the OTLP spec, with base = 2^(2^-scale), bucket `index` covers the
// half-open interval (base^index, base^(index+1)]. This returns the lower and
// upper value bound for a bucket index at a given scale, so the frontend can
// place exp-histogram buckets on the same value axis as explicit histograms.
//
// Works for positive bucket indices (the magnitude axis). Negative-bucket
// callers apply these bounds to |value| and negate.
export function expoBoundsForBucket(
  scale: number,
  index: number,
): { lower: number; upper: number } {
  const base = Math.pow(2, Math.pow(2, -scale))
  const lower = Math.pow(base, index)
  const upper = Math.pow(base, index + 1)
  return { lower, upper }
}

function resolveRootSpan(trace: StoredTrace): StoredSpan | undefined {
  const spans = Array.from(trace.spans.values())
  const rootSpan = spans.find((s) => !s.parentSpanId || s.parentSpanId === '')
  if (rootSpan) {
    return rootSpan
  }

  const orphans = spans.filter((s) => !trace.spans.has(s.parentSpanId))
  if (orphans.length > 0) {
    orphans.sort((a, b) =>
      BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1,
    )
    return orphans[0]
  }
}

export function resolveRootSpanName(trace: StoredTrace): string {
  const rootSpan = resolveRootSpan(trace)
  return rootSpan?.name || 'unknown'
}

export function resolveRootServiceName(trace: StoredTrace): string {
  const rootSpan = resolveRootSpan(trace)
  const serviceName = rootSpan?.resource['service.name']
  return typeof serviceName === 'string' && serviceName.length > 0
    ? serviceName
    : 'unknown'
}
