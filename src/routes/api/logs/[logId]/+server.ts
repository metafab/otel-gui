import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ params }) => {
  const { logId } = params
  const log = traceStore.getLog(logId)

  if (!log) {
    throw error(404, 'Log not found')
  }

  return json(log)
}
