// SSE endpoint — streams metric-list updates to the client in real-time.
//
// Three event types are emitted on a shared connection:
//   - `metrics-count`    : current metric count (used by the tab badge)
//   - `metrics-snapshot` : full list + cursor; sent on connect and after any
//                          explicit clear/delete so the client can re-sync
//   - `metrics-append`   : only the metrics touched since the client's cursor
//
// Mirrors the logs delta protocol so the list view streams flash-free.
import { traceStore } from '$lib/server/traceStore'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // Per-connection cursors.
  let lastSeq = 0
  let lastRemovalSeq = traceStore.getMetricRemovalSeq()

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

      const sendCount = () =>
        send('metrics-count', String(traceStore.getMetricCount()))

      const sendSnapshot = () => {
        const metrics = traceStore.getMetricList(traceStore.maxMetrics)
        lastSeq = traceStore.getMaxMetricSeq()
        lastRemovalSeq = traceStore.getMetricRemovalSeq()
        send('metrics-snapshot', JSON.stringify({ metrics }))
      }

      const sendAppend = () => {
        const maxSeq = traceStore.getMaxMetricSeq()
        if (maxSeq <= lastSeq) return
        const metrics = traceStore.getMetricsSince(lastSeq, traceStore.maxMetrics)
        lastSeq = maxSeq
        if (metrics.length > 0) {
          send('metrics-append', JSON.stringify({ metrics }))
        }
      }

      // Send current state immediately on connect.
      sendCount()
      sendSnapshot()

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          if (!sendCount()) return
          // A clear/delete happened — the cursor model can't express removals,
          // so re-snapshot. Otherwise stream only the changed metrics.
          if (traceStore.getMetricRemovalSeq() !== lastRemovalSeq) {
            sendSnapshot()
          } else {
            sendAppend()
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
