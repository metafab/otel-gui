// API endpoint to get trace list
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ url }) => {
  const limitParam = url.searchParams.get('limit')
  const DEFAULT_LIMIT = 100

  let limit = DEFAULT_LIMIT

  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10)

    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, traceStore.maxTraces)
    }
  }
  const traces = traceStore.getTraceList(limit)

  return json(traces)
}

export const DELETE: RequestHandler = async ({ request }) => {
  if (!request) {
    traceStore.clear()
    return json({ success: true, deletedCount: null, mode: 'all' })
  }

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json()
      const traceIds = body?.traceIds

      if (Array.isArray(traceIds)) {
        const validTraceIds = traceIds.filter(
          (traceId: unknown): traceId is string => typeof traceId === 'string',
        )

        const deletedCount = traceStore.deleteTraces(validTraceIds)
        return json({ success: true, deletedCount, mode: 'selected' })
      }
    } catch {
      return json({ error: 'Malformed JSON payload' }, { status: 400 })
    }
  }

  traceStore.clear()
  return json({ success: true, deletedCount: null, mode: 'all' })
}
