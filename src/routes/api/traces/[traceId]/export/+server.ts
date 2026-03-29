import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { serializeTraceExport } from '$lib/server/traceTransfer'

export const GET: RequestHandler = async ({ params }) => {
  const trace = traceStore.getTrace(params.traceId)

  if (!trace) {
    throw error(404, 'Trace not found')
  }

  const payload = serializeTraceExport(trace)

  return json(payload, {
    headers: {
      'Content-Disposition': `attachment; filename="trace-${trace.traceId}.json"`,
    },
  })
}
