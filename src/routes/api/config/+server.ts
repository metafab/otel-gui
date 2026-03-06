// Returns server-side configuration values needed by the frontend
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async () => {
  return json({ maxTraces: traceStore.maxTraces })
}
