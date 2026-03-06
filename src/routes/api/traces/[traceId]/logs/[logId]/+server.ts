import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ params }) => {
  const { traceId, logId } = params
  const trace = traceStore.getTrace(traceId)

  if (!trace) {
    throw error(404, 'Trace not found')
  }

  const log = trace.logs?.get(logId)
  if (!log) {
    throw error(404, 'Log not found')
  }

  return json({
    id: logId,
    ...log,
  })
}
