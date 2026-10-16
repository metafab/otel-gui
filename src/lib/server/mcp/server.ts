import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TraceStore } from '#lib/types.js'
import { resolveRootServiceName, resolveRootSpanName } from '#otel-gui/core'
import { z } from 'zod'

const SERVER_INFO = {
  name: 'otel-gui',
  version: import.meta.env.PACKAGE_VERSION,
}
const MAX_TOOL_RESULTS = 100
const MAX_RESPONSE_BYTES = 1_048_576
const MAX_QUERY_LENGTH = 500

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

function jsonResult(value: unknown) {
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      'Tool result exceeds the 1 MiB response limit. Reduce the requested result size.',
    )
  }

  return { content: [{ type: 'text' as const, text }] }
}

function includesQuery(value: unknown, query: string | undefined): boolean {
  if (!query) return true
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase())
}

export function createMcpServer(store: TraceStore): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
  })

  server.registerTool(
    'search_traces',
    {
      title: 'Search traces',
      description:
        'Search retained traces by text, service, and error status. Text is matched against trace and span names, status messages, events, and attributes. Returns matching trace summaries and matching span names.',
      inputSchema: {
        query: z.string().max(MAX_QUERY_LENGTH).optional(),
        service: z.string().max(200).optional(),
        hasError: z.boolean().optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_RESULTS).default(20),
      },
      annotations: readOnlyAnnotations,
    },
    ({ query, service, hasError, limit }) => {
      const matches = []
      let total = 0

      for (const item of store.getTraceList(store.maxTraces)) {
        if (service && !item.allServices.includes(service)) continue
        if (hasError !== undefined && item.hasError !== hasError) continue

        const trace = store.getTrace(item.traceId)
        if (!trace) continue

        const matchedSpans = []
        for (const span of trace.spans.values()) {
          if (
            query &&
            !includesQuery(
              {
                name: span.name,
                status: span.status,
                events: span.events,
                attributes: span.attributes,
                resource: span.resource,
              },
              query,
            )
          ) {
            continue
          }
          if (service && span.resource['service.name'] !== service) continue
          matchedSpans.push({
            spanId: span.spanId,
            name: span.name,
            serviceName: span.resource['service.name'] ?? 'unknown',
            status: span.status,
          })
        }

        const traceMatches =
          !query ||
          includesQuery(
            {
              traceId: item.traceId,
              rootSpanName: item.rootSpanName,
              serviceName: item.serviceName,
            },
            query,
          )
        if (matchedSpans.length === 0 && !traceMatches) continue
        total++
        if (matches.length < limit) {
          matches.push({
            traceId: item.traceId,
            rootSpanName: resolveRootSpanName(trace),
            serviceName:
              resolveRootServiceName(trace) === 'unknown'
                ? trace.serviceName
                : resolveRootServiceName(trace),
            startTimeUnixNano: trace.startTimeUnixNano,
            endTimeUnixNano: trace.endTimeUnixNano,
            spanCount: trace.spanCount,
            hasError: trace.hasError,
            matchedSpans: matchedSpans.slice(0, 25),
            matchedSpanCount: matchedSpans.length,
          })
        }
      }

      return jsonResult({ total, returned: matches.length, traces: matches })
    },
  )

  server.registerTool(
    'get_trace',
    {
      title: 'Get trace',
      description:
        'Fetch a trace by ID, including span attributes, events, links, and status. Span output is capped; the result indicates when spans were omitted.',
      inputSchema: {
        traceId: z.string().min(1).max(64),
        maxSpans: z.number().int().min(1).max(1000).default(250),
      },
      annotations: readOnlyAnnotations,
    },
    ({ traceId, maxSpans }) => {
      const trace = store.getTrace(traceId)
      if (!trace) throw new Error(`Trace not found: ${traceId}`)

      const spans = Array.from(trace.spans.values())
      return jsonResult({
        traceId: trace.traceId,
        rootSpanName: resolveRootSpanName(trace),
        serviceName:
          resolveRootServiceName(trace) === 'unknown'
            ? trace.serviceName
            : resolveRootServiceName(trace),
        startTimeUnixNano: trace.startTimeUnixNano,
        endTimeUnixNano: trace.endTimeUnixNano,
        spanCount: trace.spanCount,
        hasError: trace.hasError,
        spansReturned: Math.min(spans.length, maxSpans),
        truncated: spans.length > maxSpans,
        spans: spans.slice(0, maxSpans),
      })
    },
  )

  server.registerTool(
    'search_logs',
    {
      title: 'Search logs',
      description:
        'Search retained logs by text, service, minimum OTLP severity number, and correlated trace ID.',
      inputSchema: {
        query: z.string().max(MAX_QUERY_LENGTH).optional(),
        service: z.string().max(200).optional(),
        severityMin: z.number().int().min(0).max(24).optional(),
        traceId: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_RESULTS).default(20),
      },
      annotations: readOnlyAnnotations,
    },
    ({ query, service, severityMin, traceId, limit }) => {
      const matches = store.getLogList(store.maxLogs).filter((log) => {
        if (service && log.serviceName !== service) return false
        if (severityMin !== undefined && log.severityNumber < severityMin)
          return false
        if (traceId && log.traceId !== traceId) return false
        const detail = store.getLog(log.id)
        return detail !== undefined && includesQuery(detail, query)
      })

      return jsonResult({
        total: matches.length,
        returned: Math.min(matches.length, limit),
        logs: matches.slice(0, limit),
      })
    },
  )

  server.registerTool(
    'get_log',
    {
      title: 'Get log',
      description: 'Fetch a full retained log record by ID.',
      inputSchema: { logId: z.string().min(1).max(512) },
      annotations: readOnlyAnnotations,
    },
    ({ logId }) => {
      const log = store.getLog(logId)
      if (!log) throw new Error(`Log not found: ${logId}`)
      return jsonResult({ log })
    },
  )

  server.registerTool(
    'search_metrics',
    {
      title: 'Search metrics',
      description:
        'Search retained metrics by text and service. Text matches metric name, unit, and series attributes.',
      inputSchema: {
        query: z.string().max(MAX_QUERY_LENGTH).optional(),
        service: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_RESULTS).default(20),
      },
      annotations: readOnlyAnnotations,
    },
    ({ query, service, limit }) => {
      const matches = []
      let total = 0

      for (const item of store.getMetricList(store.maxMetrics)) {
        if (service && item.serviceName !== service) continue
        const metric = store.getMetric(item.id)
        if (!metric) continue
        const seriesAttributes = Array.from(metric.series.values()).map(
          (series) => series.attributes,
        )
        if (
          !includesQuery(
            {
              name: item.name,
              description: metric.description,
              unit: item.unit,
              serviceName: item.serviceName,
              seriesAttributes,
            },
            query,
          )
        ) {
          continue
        }
        total++
        if (matches.length < limit) matches.push(item)
      }

      return jsonResult({ total, returned: matches.length, metrics: matches })
    },
  )

  server.registerTool(
    'get_metric',
    {
      title: 'Get metric',
      description:
        'Fetch a retained metric by ID with a bounded number of recent points per series.',
      inputSchema: {
        metricId: z.string().min(1).max(512),
        maxPointsPerSeries: z.number().int().min(1).max(500).default(100),
      },
      annotations: readOnlyAnnotations,
    },
    ({ metricId, maxPointsPerSeries }) => {
      const metric = store.getMetricDetail(metricId)
      if (!metric) throw new Error(`Metric not found: ${metricId}`)

      return jsonResult({
        ...metric,
        series: metric.series.map((series) => ({
          ...series,
          totalPoints: series.points.length,
          truncated: series.points.length > maxPointsPerSeries,
          points: series.points.slice(-maxPointsPerSeries),
        })),
      })
    },
  )

  server.registerTool(
    'list_services',
    {
      title: 'List services',
      description:
        'List retained services and counts of traces, logs, and metrics associated with each service.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    () => {
      const services = new Map<
        string,
        { traceCount: number; logCount: number; metricCount: number }
      >()
      const getCounts = (name: string) => {
        let counts = services.get(name)
        if (!counts) {
          counts = { traceCount: 0, logCount: 0, metricCount: 0 }
          services.set(name, counts)
        }
        return counts
      }

      for (const trace of store.getTraceList(store.maxTraces)) {
        for (const service of new Set(trace.allServices)) {
          getCounts(service).traceCount++
        }
      }
      for (const log of store.getLogList(store.maxLogs)) {
        getCounts(log.serviceName).logCount++
      }
      for (const metric of store.getMetricList(store.maxMetrics)) {
        getCounts(metric.serviceName).metricCount++
      }

      const listedServices = Array.from(services, ([name, counts]) => ({
        name,
        ...counts,
      })).sort((a, b) => a.name.localeCompare(b.name))
      return jsonResult({
        total: listedServices.length,
        returned: Math.min(listedServices.length, MAX_TOOL_RESULTS),
        truncated: listedServices.length > MAX_TOOL_RESULTS,
        services: listedServices.slice(0, MAX_TOOL_RESULTS),
      })
    },
  )

  server.registerTool(
    'get_service_map',
    {
      title: 'Get service map',
      description:
        'Fetch service dependency nodes and edges, with call/error counts and latency percentiles. Optionally scope the map to one trace.',
      inputSchema: { traceId: z.string().min(1).max(64).optional() },
      annotations: readOnlyAnnotations,
    },
    ({ traceId }) => {
      if (traceId && !store.getTrace(traceId)) {
        throw new Error(`Trace not found: ${traceId}`)
      }
      return jsonResult(store.getServiceMap(traceId))
    },
  )

  return server
}
