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
      limit = Math.min(parsed, traceStore.maxLogs)
    }
  }

  return json(traceStore.getLogList(limit))
}

export const DELETE: RequestHandler = async ({ request }) => {
  if (!request) {
    traceStore.clearLogs()
    return json({ success: true, deletedCount: null, mode: 'all' })
  }

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json()
      const logIds = body?.logIds

      if (Array.isArray(logIds)) {
        const validLogIds = logIds.filter(
          (logId: unknown): logId is string => typeof logId === 'string',
        )

        const deletedCount = traceStore.deleteLogs(validLogIds)
        return json({ success: true, deletedCount, mode: 'selected' })
      }
    } catch {
      return json({ error: 'Malformed JSON payload' }, { status: 400 })
    }
  }

  traceStore.clearLogs()
  return json({ success: true, deletedCount: null, mode: 'all' })
}
