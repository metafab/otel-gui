import type {
  LogExportEnvelope,
  LogExportItem,
  LogImportPreview,
  TraceLogDetail,
} from '#lib/types.js'
import { flattenAttributes } from '#otel-gui/core'
import { toAnyValue, toKeyValues } from '#lib/server/otlpEncode.js'

const EXPORT_FORMAT = 'otel-gui-log-export'
const EXPORT_VERSION = 1
const NANO_REGEX = /^\d+$/
const LOG_ID_ATTRIBUTE = 'log.record.uid'

interface NormalizedLogImportPayload {
  resourceLogs: any[]
  preview: LogImportPreview
}

function serializeLogExportItem(log: TraceLogDetail): LogExportItem {
  return {
    logId: log.id,
    resourceLogs: [
      {
        resource: { attributes: toKeyValues(log.resource) },
        scopeLogs: [
          {
            scope: {
              name: log.scopeName,
              version: log.scopeVersion,
              attributes: toKeyValues(log.scopeAttributes),
            },
            logRecords: [
              {
                timeUnixNano: log.timeUnixNano,
                observedTimeUnixNano: log.observedTimeUnixNano,
                severityNumber: log.severityNumber,
                severityText: log.severityText,
                body: toAnyValue(log.body),
                attributes: toKeyValues(log.attributes),
                traceId: log.traceId,
                spanId: log.spanId,
              },
            ],
          },
        ],
      },
    ],
  }
}

export function serializeLogsExport(logs: TraceLogDetail[]): LogExportEnvelope {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    logCount: logs.length,
    logs: logs.map((log) => serializeLogExportItem(log)),
  }
}

function looksLikeTracePayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as { format?: unknown; resourceSpans?: unknown }
  return record.format === 'otel-gui-trace-export' || 'resourceSpans' in record
}

function isExportEnvelope(value: unknown): value is LogExportEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { format?: unknown }).format === EXPORT_FORMAT &&
    Array.isArray((value as { logs?: unknown }).logs)
  )
}

// Pin the exported log id on each record so re-importing overwrites the
// original entry instead of creating a duplicate.
function stampLogId(resourceLogs: any[], logId: string): any[] {
  return resourceLogs.map((resourceLog) => ({
    ...resourceLog,
    scopeLogs: (Array.isArray(resourceLog?.scopeLogs)
      ? resourceLog.scopeLogs
      : []
    ).map((scopeLog: any) => ({
      ...scopeLog,
      logRecords: (Array.isArray(scopeLog?.logRecords)
        ? scopeLog.logRecords
        : []
      ).map((record: any) => {
        const attributes = Array.isArray(record?.attributes)
          ? record.attributes
          : []
        if (attributes.some((kv: any) => kv?.key === LOG_ID_ATTRIBUTE)) {
          return record
        }
        return {
          ...record,
          attributes: [
            ...attributes,
            { key: LOG_ID_ATTRIBUTE, value: { stringValue: logId } },
          ],
        }
      }),
    })),
  }))
}

function validateLogRecord(record: any): void {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid OTLP payload: log record must be an object')
  }

  const hasTime = (value: unknown) =>
    typeof value === 'string' && NANO_REGEX.test(value) && value !== '0'

  if (!hasTime(record.timeUnixNano) && !hasTime(record.observedTimeUnixNano)) {
    throw new Error(
      'Invalid OTLP payload: log record needs a timeUnixNano or observedTimeUnixNano nanosecond string',
    )
  }
}

function collectPreview(
  resourceLogs: any[],
  fileName: string | null,
  exportedAt: string | null,
  sizeBytes: number,
  format: LogImportPreview['format'],
  existingLogCount: number,
  maxLogs: number,
): LogImportPreview {
  const services = new Set<string>()
  let logCount = 0

  for (const resourceLog of resourceLogs) {
    const serviceName = flattenAttributes(resourceLog?.resource?.attributes)[
      'service.name'
    ]
    if (typeof serviceName === 'string' && serviceName.length > 0) {
      services.add(serviceName)
    }

    const scopeLogs = Array.isArray(resourceLog?.scopeLogs)
      ? resourceLog.scopeLogs
      : []
    for (const scopeLog of scopeLogs) {
      const records = Array.isArray(scopeLog?.logRecords)
        ? scopeLog.logRecords
        : []
      for (const record of records) {
        validateLogRecord(record)
        logCount += 1
      }
    }
  }

  if (logCount === 0) {
    throw new Error('Invalid OTLP payload: no log records found')
  }

  const warnings: string[] = []
  const nextCount = existingLogCount + logCount
  if (nextCount > maxLogs) {
    const evicted = nextCount - maxLogs
    warnings.push(
      `Import may evict ${evicted} older log${evicted === 1 ? '' : 's'} because retention is limited to ${maxLogs}.`,
    )
  }

  return {
    format,
    fileName,
    exportedAt,
    sizeBytes,
    logCount,
    services: Array.from(services).sort(),
    warnings,
  }
}

export function parseLogImportPayload(
  payload: unknown,
  options: {
    fileName?: string | null
    sizeBytes: number
    existingLogCount: number
    maxLogs: number
  },
): NormalizedLogImportPayload {
  let resourceLogs: any[]
  let format: LogImportPreview['format']
  let exportedAt: string | null = null

  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { resourceLogs?: unknown }).resourceLogs)
  ) {
    resourceLogs = (payload as { resourceLogs: any[] }).resourceLogs
    format = 'otlp-json'
  } else if (isExportEnvelope(payload)) {
    resourceLogs = payload.logs.flatMap((item) => {
      const items = Array.isArray(item?.resourceLogs) ? item.resourceLogs : []
      return typeof item?.logId === 'string' && item.logId.length > 0
        ? stampLogId(items, item.logId)
        : items
    })
    format = 'otel-gui-log-export'
    exportedAt =
      typeof payload.exportedAt === 'string' ? payload.exportedAt : null
  } else {
    if (looksLikeTracePayload(payload)) {
      throw new Error(
        'This file contains traces, not logs. Use Import Traces on the Traces tab instead.',
      )
    }
    throw new Error(
      'Unsupported import payload: expected OTLP JSON or otel-gui export',
    )
  }

  if (resourceLogs.length === 0) {
    throw new Error('Invalid OTLP payload: missing resourceLogs')
  }

  return {
    resourceLogs,
    preview: collectPreview(
      resourceLogs,
      options.fileName ?? null,
      exportedAt,
      options.sizeBytes,
      format,
      options.existingLogCount,
      options.maxLogs,
    ),
  }
}
