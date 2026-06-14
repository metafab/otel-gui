import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

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

  const logs = traceStore.getTraceLogs(traceId, limit)
  const filtered = spanIdFilter
    ? logs.filter((log) => log.spanId === spanIdFilter)
    : logs

  return json(filtered)
}
