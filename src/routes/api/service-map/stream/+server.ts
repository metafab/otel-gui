// SSE endpoint — streams the global service map to the client in real-time.
//
// Two event types are emitted on a shared connection:
//   - `map-count`    : current service-node count (used by the tab badge)
//   - `map-snapshot` : the full map ({ nodes, edges }); sent on connect and
//                      whenever the cumulative aggregate changes
//
// The service map is a small derived aggregate, not an append-only list, so
// there is no delta/append event — each change re-sends the (tiny) snapshot.
// The server only recomputes/sends when `serviceMapSeq` advances, replacing the
// old ~133 req/s polling storm with a single push stream that emits on change.
import { traceStore } from '$lib/server/traceStore'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // Per-connection cursor — the last serviceMapSeq we sent a snapshot for.
  let lastSeq = -1

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
      const send = (event: string, data: string): boolean => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
          return true
        } catch {
          // Controller already closed (client disconnected).
          cleanup()
          return false
        }
      }

      const sendSnapshot = () => {
        const data = traceStore.getServiceMap()
        lastSeq = traceStore.getServiceMapSeq()
        send('map-count', String(data.nodes.length))
        return send('map-snapshot', JSON.stringify(data))
      }

      // Send current state immediately on connect.
      sendSnapshot()

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          // Only recompute + re-send when the map actually changed.
          if (traceStore.getServiceMapSeq() !== lastSeq) {
            sendSnapshot()
          }
        }, 100)
      })

      // Heartbeat every 30 s — keeps proxies/load-balancers from closing the connection.
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
