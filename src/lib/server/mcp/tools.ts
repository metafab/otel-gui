// MCP tool definitions for otel-gui.
//
// Mostly read-only tools that let an agent (or a human via an MCP client) search
// and fetch the telemetry the GUI already holds in memory, plus one write action
// (`flush`) that clears the buffers. Every handler is a thin call into the trace
// store — the same methods that back the REST/SSE endpoints and the UI search —
// so behaviour stays in one place.
//
// Tools are built from a store instance (createMcpTools) rather than importing
// the singleton, so they can be unit-tested against a seeded store.

import type { SearchKind, TraceStore } from '$lib/types'
import { resolveRootServiceName, resolveRootSpanName } from '@otel-gui/core'
import { flushTelemetry } from '$lib/server/flush'

export interface McpTool {
  name: string
  description: string
  // JSON Schema for the tool arguments (draft-07 shape; MCP clients validate).
  inputSchema: Record<string, unknown>
  // Returns a JSON-serializable object used as both text and structured content.
  handler: (args: Record<string, unknown>) => object
}

// ─── Argument coercion ─────────────────────────────────────────────────────
// JSON-RPC arguments arrive untyped; coerce defensively and ignore junk.

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = asString(args[key])
  if (value === undefined) throw new Error(`Missing required "${key}"`)
  return value
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

const VALID_KINDS: SearchKind[] = ['traces', 'logs', 'metrics']

function asKinds(value: unknown): SearchKind[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kinds = value.filter((k): k is SearchKind =>
    VALID_KINDS.includes(k as SearchKind),
  )
  return kinds.length > 0 ? kinds : undefined
}

// Hard cap on any single search result set, so a generous `limit` can't blow up
// an agent's context. The store default (200) applies when unspecified.
const MAX_SEARCH_LIMIT = 500

function asLimit(value: unknown): number | undefined {
  const n = asNumber(value)
  if (n === undefined) return undefined
  return Math.min(Math.max(1, Math.floor(n)), MAX_SEARCH_LIMIT)
}

// Require an optional store method (search/list are optional on TraceStore so
// external persistence backends need not implement them). Throws a clear error
// instead of a TypeError if a backend lacks the capability.
function requireCapability<T>(fn: T | undefined, name: string): T {
  if (typeof fn !== 'function') {
    throw new Error(`This storage backend does not support ${name}`)
  }
  return fn
}

const QUERY_PROP = {
  type: 'string',
  description:
    'Case-insensitive substring; matched across messages/attributes.',
}
const SERVICE_PROP = {
  type: 'string',
  description: 'Restrict to this service.name.',
}
const LIMIT_PROP = {
  type: 'integer',
  description: `Max results (1–${MAX_SEARCH_LIMIT}).`,
}

export function createMcpTools(store: TraceStore): McpTool[] {
  return [
    {
      name: 'search',
      description:
        'Search across traces, logs, and metrics at once for a keyword. Deep ' +
        'substring match over messages, span names, status, and attributes. ' +
        'Best starting point when you do not know where a value lives.',
      inputSchema: {
        type: 'object',
        properties: {
          query: QUERY_PROP,
          kinds: {
            type: 'array',
            items: { type: 'string', enum: VALID_KINDS },
            description: 'Signals to search; defaults to all three.',
          },
          service: SERVICE_PROP,
          limit: LIMIT_PROP,
        },
        required: ['query'],
      },
      handler: (args) =>
        requireCapability(
          store.searchAll,
          'search',
        )({
          query: requireString(args, 'query'),
          kinds: asKinds(args.kinds),
          service: asString(args.service),
          limit: asLimit(args.limit),
        }),
    },
    {
      name: 'search_traces',
      description:
        'Search traces by keyword and/or filters. Matches span names, status ' +
        'messages, events, and attributes; each hit lists which spans matched.',
      inputSchema: {
        type: 'object',
        properties: {
          query: QUERY_PROP,
          service: SERVICE_PROP,
          hasError: {
            type: 'boolean',
            description: 'Only traces with (true) / without (false) errors.',
          },
          limit: LIMIT_PROP,
        },
      },
      handler: (args) => ({
        traces: requireCapability(
          store.searchTraces,
          'search_traces',
        )({
          query: asString(args.query),
          service: asString(args.service),
          hasError: asBoolean(args.hasError),
          limit: asLimit(args.limit),
        }),
      }),
    },
    {
      name: 'get_trace',
      description:
        'Fetch one full trace by id, including every span with attributes, ' +
        'events, links, and status.',
      inputSchema: {
        type: 'object',
        properties: {
          traceId: { type: 'string', description: 'The trace id.' },
        },
        required: ['traceId'],
      },
      handler: (args) => {
        const traceId = requireString(args, 'traceId')
        const trace = store.getTrace(traceId)
        if (!trace) throw new Error(`Trace not found: ${traceId}`)
        return {
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
          spans: Array.from(trace.spans.values()),
        }
      },
    },
    {
      name: 'search_logs',
      description:
        'Search log records by keyword and/or filters. Matches the body, ' +
        'severity text, and all attributes (log/resource/scope).',
      inputSchema: {
        type: 'object',
        properties: {
          query: QUERY_PROP,
          service: SERVICE_PROP,
          severityMin: {
            type: 'integer',
            description:
              'Minimum OTLP severityNumber (17 = ERROR, 21 = FATAL).',
          },
          traceId: {
            type: 'string',
            description: 'Only logs correlated to this trace id.',
          },
          limit: LIMIT_PROP,
        },
      },
      handler: (args) => ({
        logs: requireCapability(
          store.searchLogs,
          'search_logs',
        )({
          query: asString(args.query),
          service: asString(args.service),
          severityMin: asNumber(args.severityMin),
          traceId: asString(args.traceId),
          limit: asLimit(args.limit),
        }),
      }),
    },
    {
      name: 'get_log',
      description: 'Fetch one full log record by id.',
      inputSchema: {
        type: 'object',
        properties: { logId: { type: 'string', description: 'The log id.' } },
        required: ['logId'],
      },
      handler: (args) => {
        const logId = requireString(args, 'logId')
        const log = store.getLog(logId)
        if (!log) throw new Error(`Log not found: ${logId}`)
        return { log }
      },
    },
    {
      name: 'search_metrics',
      description:
        'Search metrics by keyword and/or service. Matches metric name, ' +
        'description, unit, and series attributes.',
      inputSchema: {
        type: 'object',
        properties: {
          query: QUERY_PROP,
          service: SERVICE_PROP,
          limit: LIMIT_PROP,
        },
      },
      handler: (args) => ({
        metrics: requireCapability(
          store.searchMetrics,
          'search_metrics',
        )({
          query: asString(args.query),
          service: asString(args.service),
          limit: asLimit(args.limit),
        }),
      }),
    },
    {
      name: 'get_metric',
      description:
        'Fetch one metric by id with all its series and time-ordered points ' +
        '(sums include a server-computed per-second rate).',
      inputSchema: {
        type: 'object',
        properties: {
          metricId: {
            type: 'string',
            description: 'The metric id (from search_metrics / list results).',
          },
        },
        required: ['metricId'],
      },
      handler: (args) => {
        const metricId = requireString(args, 'metricId')
        const metric = store.getMetricDetail(metricId)
        if (!metric) throw new Error(`Metric not found: ${metricId}`)
        return metric
      },
    },
    {
      name: 'list_services',
      description:
        'List every service currently in the store with per-signal counts ' +
        '(traces/logs/metrics). Use to discover valid `service` filter values.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({
        services: requireCapability(store.listServices, 'list_services')(),
      }),
    },
    {
      name: 'get_service_map',
      description:
        'Fetch the service dependency map: nodes (services/databases) and ' +
        'edges with call/error counts and latency percentiles.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => {
        const map = store.getServiceMap()
        return { nodes: map.nodes, edges: map.edges }
      },
    },
    {
      name: 'flush',
      description:
        'Clear ALL buffered telemetry — traces, logs, metrics, and the service ' +
        'map — so you can start from a clean state before running an activity, ' +
        'then investigate only what that activity produced. Destructive and ' +
        'irreversible: it drops everything currently held in memory. Returns the ' +
        'counts that were cleared.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ cleared: flushTelemetry(store) }),
    },
  ]
}
