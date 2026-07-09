// Flush all telemetry buffers in one call — see src/lib/server/flush.ts.
// Used by the front-end "Flush" button to reset to a clean state before running
// an activity. Live views clear themselves via the SSE snapshot that clearing
// triggers.
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { flushTelemetry } from '$lib/server/flush'

export const POST: RequestHandler = async () => {
  const cleared = flushTelemetry(traceStore)
  return json({ success: true, cleared })
}
