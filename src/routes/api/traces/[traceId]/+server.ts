// API endpoint to get individual trace detail
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore, resolveRootSpanName } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ params }) => {
  const { traceId } = params

  const trace = traceStore.getTrace(traceId)

  if (!trace) {
    throw error(404, 'Trace not found')
  }

  // Convert spans Map to Record for JSON serialization
  const spansRecord: Record<string, any> = {}
  for (const [id, span] of trace.spans.entries()) {
    spansRecord[id] = span
  }

  return json({
    ...trace,
    rootSpanName: resolveRootSpanName(trace),
    spans: spansRecord,
  })
}
