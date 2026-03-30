import type {
  StoredSpan,
  StoredTrace,
  TraceExportItem,
  TraceExportEnvelope,
  TraceImportPreview,
} from '$lib/types'
import { flattenAttributes } from '$lib/utils/attributes'

const EXPORT_FORMAT = 'otel-gui-trace-export'
const EXPORT_VERSION = 1
const NANO_REGEX = /^\d+$/

type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: AnyValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: AnyValue }> } }

interface NormalizedImportPayload {
  resourceSpans: any[]
  preview: TraceImportPreview
}

function toAnyValue(value: unknown): AnyValue {
  if (typeof value === 'boolean') {
    return { boolValue: value }
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intValue: String(value) }
    }
    return { doubleValue: value }
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toAnyValue(item)),
      },
    }
  }

  if (value && typeof value === 'object') {
    return {
      kvlistValue: {
        values: Object.entries(value as Record<string, unknown>).map(
          ([key, nestedValue]) => ({
            key,
            value: toAnyValue(nestedValue),
          }),
        ),
      },
    }
  }

  return { stringValue: value == null ? '' : String(value) }
}

function toKeyValues(record: Record<string, unknown>): Array<{
  key: string
  value: AnyValue
}> {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }))
}

function toOtlpSpan(span: StoredSpan): any {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: toKeyValues(span.attributes),
    events: span.events.map((event) => ({
      timeUnixNano: event.timeUnixNano,
      name: event.name,
      attributes: toKeyValues(event.attributes),
    })),
    links: span.links.map((link) => ({
      traceId: link.traceId,
      spanId: link.spanId,
      traceState: link.traceState,
      attributes: toKeyValues(link.attributes),
    })),
    status: {
      code: span.status.code,
      message: span.status.message,
    },
  }
}

function serializeTraceExportItem(trace: StoredTrace): TraceExportItem {
  const groups = new Map<
    string,
    {
      resource: Record<string, unknown>
      scopeName: string
      scopeVersion: string
      scopeAttributes: Record<string, unknown>
      spans: StoredSpan[]
    }
  >()

  for (const span of trace.spans.values()) {
    const key = JSON.stringify({
      resource: span.resource,
      scopeName: span.scopeName,
      scopeVersion: span.scopeVersion,
      scopeAttributes: span.scopeAttributes,
    })

    const existing = groups.get(key)
    if (existing) {
      existing.spans.push(span)
      continue
    }

    groups.set(key, {
      resource: span.resource,
      scopeName: span.scopeName,
      scopeVersion: span.scopeVersion,
      scopeAttributes: span.scopeAttributes,
      spans: [span],
    })
  }

  const resourceSpans = Array.from(groups.values()).map((group) => ({
    resource: {
      attributes: toKeyValues(group.resource),
    },
    scopeSpans: [
      {
        scope: {
          name: group.scopeName,
          version: group.scopeVersion,
          attributes: toKeyValues(group.scopeAttributes),
        },
        spans: group.spans
          .slice()
          .sort((left, right) =>
            BigInt(left.startTimeUnixNano) < BigInt(right.startTimeUnixNano)
              ? -1
              : 1,
          )
          .map((span) => toOtlpSpan(span)),
      },
    ],
  }))

  return {
    traceId: trace.traceId,
    resourceSpans,
  }
}

export function serializeTracesExport(
  traces: StoredTrace[],
): TraceExportEnvelope {
  const exportItems = traces.map((trace) => serializeTraceExportItem(trace))
  const totalSpanCount = traces.reduce(
    (total, trace) => total + trace.spanCount,
    0,
  )

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    traceCount: traces.length,
    spanCount: totalSpanCount,
    traces: exportItems,
  }
}

export function serializeTraceExport(trace: StoredTrace): TraceExportEnvelope {
  return serializeTracesExport([trace])
}

function isExportEnvelope(value: unknown): value is TraceExportEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    'format' in value &&
    (value as { format?: unknown }).format === EXPORT_FORMAT &&
    'traces' in value &&
    Array.isArray((value as { traces?: unknown[] }).traces)
  )
}

function validateSpan(span: any): void {
  if (!span || typeof span !== 'object') {
    throw new Error('Invalid OTLP payload: span must be an object')
  }

  if (typeof span.traceId !== 'string' || span.traceId.length === 0) {
    throw new Error('Invalid OTLP payload: span.traceId is required')
  }

  if (typeof span.spanId !== 'string' || span.spanId.length === 0) {
    throw new Error('Invalid OTLP payload: span.spanId is required')
  }

  if (
    typeof span.startTimeUnixNano !== 'string' ||
    !NANO_REGEX.test(span.startTimeUnixNano)
  ) {
    throw new Error(
      'Invalid OTLP payload: startTimeUnixNano must be a nanosecond string',
    )
  }

  if (
    typeof span.endTimeUnixNano !== 'string' ||
    !NANO_REGEX.test(span.endTimeUnixNano)
  ) {
    throw new Error(
      'Invalid OTLP payload: endTimeUnixNano must be a nanosecond string',
    )
  }
}

function collectPreview(
  resourceSpans: any[],
  fileName: string | null,
  exportedAt: string | null,
  envelopeTraceCount: number | null,
  envelopeTracesWithoutSpans: number,
  sizeBytes: number,
  format: TraceImportPreview['format'],
  existingTraceIds: Set<string>,
  maxTraces: number,
): TraceImportPreview {
  const traceIds = new Set<string>()
  const services = new Set<string>()
  let spanCount = 0

  for (const resourceSpan of resourceSpans) {
    const resourceAttributes = flattenAttributes(
      resourceSpan.resource?.attributes,
    )
    const serviceName = resourceAttributes['service.name']
    if (typeof serviceName === 'string' && serviceName.length > 0) {
      services.add(serviceName)
    }

    const scopeSpans = Array.isArray(resourceSpan.scopeSpans)
      ? resourceSpan.scopeSpans
      : []

    for (const scopeSpan of scopeSpans) {
      const spans = Array.isArray(scopeSpan.spans) ? scopeSpan.spans : []
      for (const span of spans) {
        validateSpan(span)
        traceIds.add(span.traceId)
        spanCount += 1
      }
    }
  }

  if (spanCount === 0) {
    throw new Error('Invalid OTLP payload: no spans found')
  }

  const newTraceCount = Array.from(traceIds).filter(
    (traceId) => !existingTraceIds.has(traceId),
  ).length
  const nextTraceCount = existingTraceIds.size + newTraceCount
  const warnings: string[] = []

  if (nextTraceCount > maxTraces) {
    warnings.push(
      `Import may evict ${nextTraceCount - maxTraces} older trace${nextTraceCount - maxTraces === 1 ? '' : 's'} because retention is limited to ${maxTraces}.`,
    )
  }

  if (envelopeTracesWithoutSpans > 0) {
    warnings.push(
      `Envelope contains ${envelopeTracesWithoutSpans} trace entr${envelopeTracesWithoutSpans === 1 ? 'y' : 'ies'} without spans; trace import ingests only traces that include spans.`,
    )
  } else if (
    envelopeTraceCount !== null &&
    envelopeTraceCount !== traceIds.size
  ) {
    warnings.push(
      `Envelope metadata declares ${envelopeTraceCount} trace${envelopeTraceCount === 1 ? '' : 's'}, while span analysis found ${traceIds.size} unique traceId values.`,
    )
  }

  return {
    format,
    fileName,
    exportedAt,
    sizeBytes,
    traceCount: envelopeTraceCount ?? traceIds.size,
    spanCount,
    services: Array.from(services).sort(),
    warnings,
  }
}

export function parseTraceImportPayload(
  payload: unknown,
  options: {
    fileName?: string | null
    sizeBytes: number
    existingTraceIds: Set<string>
    maxTraces: number
  },
): NormalizedImportPayload {
  let resourceSpans: any[]
  let format: TraceImportPreview['format']
  let exportedAt: string | null = null
  let envelopeTraceCount: number | null = null
  let envelopeTracesWithoutSpans = 0

  if (
    payload &&
    typeof payload === 'object' &&
    'resourceSpans' in payload &&
    Array.isArray((payload as { resourceSpans?: unknown[] }).resourceSpans)
  ) {
    resourceSpans = (payload as { resourceSpans: any[] }).resourceSpans
    format = 'otlp-json'
  } else if (isExportEnvelope(payload)) {
    resourceSpans = payload.traces.flatMap((trace) => trace.resourceSpans)
    format = 'otel-gui-trace-export'
    exportedAt =
      typeof payload.exportedAt === 'string' ? payload.exportedAt : null
    envelopeTraceCount =
      typeof payload.traceCount === 'number' ? payload.traceCount : null
    envelopeTracesWithoutSpans = payload.traces.filter((trace) => {
      const resourceSpans = Array.isArray(trace.resourceSpans)
        ? trace.resourceSpans
        : []

      for (const resourceSpan of resourceSpans) {
        const scopeSpans = Array.isArray(resourceSpan.scopeSpans)
          ? resourceSpan.scopeSpans
          : []
        for (const scopeSpan of scopeSpans) {
          if (Array.isArray(scopeSpan.spans) && scopeSpan.spans.length > 0) {
            return false
          }
        }
      }

      return true
    }).length
  } else {
    throw new Error(
      'Unsupported import payload: expected OTLP JSON or otel-gui export',
    )
  }

  if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) {
    throw new Error('Invalid OTLP payload: missing resourceSpans')
  }

  return {
    resourceSpans,
    preview: collectPreview(
      resourceSpans,
      options.fileName ?? null,
      exportedAt,
      envelopeTraceCount,
      envelopeTracesWithoutSpans,
      options.sizeBytes,
      format,
      options.existingTraceIds,
      options.maxTraces,
    ),
  }
}
