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
