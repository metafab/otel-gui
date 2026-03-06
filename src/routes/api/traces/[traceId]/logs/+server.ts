import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

function getLogTimestamp(log: { timeUnixNano: string; observedTimeUnixNano: string }): string {
  return log.timeUnixNano || log.observedTimeUnixNano || '0'
}

export const GET: RequestHandler = async ({ params, url }) => {
  const { traceId } = params
  const trace = traceStore.getTrace(traceId)

  if (!trace) {
    throw error(404, 'Trace not found')
  }

  const limitParam = url.searchParams.get('limit')
  const spanIdFilter = url.searchParams.get('spanId')

  const DEFAULT_LIMIT = 100
  const MAX_LIMIT = 5000

  let limit = DEFAULT_LIMIT
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT)
    }
  }

  const entries = Array.from(trace.logs?.entries() || [])

  const filtered = spanIdFilter
    ? entries.filter(([, log]) => log.spanId === spanIdFilter)
    : entries

  filtered.sort(([, a], [, b]) => {
    const aTs = BigInt(getLogTimestamp(a))
    const bTs = BigInt(getLogTimestamp(b))
    return aTs > bTs ? -1 : aTs < bTs ? 1 : 0
  })

  const items = filtered.slice(0, limit).map(([id, log]) => ({
    id,
    traceId: log.traceId,
    spanId: log.spanId,
    timeUnixNano: log.timeUnixNano,
    observedTimeUnixNano: log.observedTimeUnixNano,
    severityNumber: log.severityNumber,
    severityText: log.severityText,
    body: log.body,
  }))

  return json(items)
}
