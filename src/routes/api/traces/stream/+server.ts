// SSE endpoint — pushes trace list updates to the client in real-time
import { traceStore } from '$lib/server/traceStore'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  function cleanup() {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately on connect
      const initial = JSON.stringify(
        traceStore.getTraceList(traceStore.maxTraces),
      )
      controller.enqueue(encoder.encode(`event: traces\ndata: ${initial}\n\n`))

      // Debounce rapid-fire ingestion (batched exports can arrive all at once)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          try {
            const data = JSON.stringify(
              traceStore.getTraceList(traceStore.maxTraces),
            )
            controller.enqueue(
              encoder.encode(`event: traces\ndata: ${data}\n\n`),
            )
          } catch {
            // Controller already closed (client disconnected)
          }
        }, 100)
      })

      // Heartbeat every 30 s — keeps proxies/load-balancers from closing the connection
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          cleanup()
        }
      }, 30_000)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
