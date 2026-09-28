import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ url }) => {
  const limitParam = url.searchParams.get('limit')
  const DEFAULT_LIMIT = 500

  let limit = DEFAULT_LIMIT

  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10)

    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, traceStore.maxMetrics)
    }
  }

  return json(traceStore.getMetricList(limit))
}

export const DELETE: RequestHandler = async ({ request }) => {
  if (!request) {
    traceStore.clearMetrics()
    return json({ success: true, deletedCount: null, mode: 'all' })
  }

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json()
      const ids = body?.ids

      if (Array.isArray(ids)) {
        const validIds = ids.filter(
          (id: unknown): id is string => typeof id === 'string',
        )

        const deletedCount = traceStore.deleteMetrics(validIds)
        return json({ success: true, deletedCount, mode: 'selected' })
      }
    } catch {
      return json({ error: 'Malformed JSON payload' }, { status: 400 })
    }
  }

  traceStore.clearMetrics()
  return json({ success: true, deletedCount: null, mode: 'all' })
}
