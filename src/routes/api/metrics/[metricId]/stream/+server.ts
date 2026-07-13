// SSE endpoint — streams a single metric's series + points for the detail page.
//
// Phase-1 simplest correct form: on connect (and on each debounced ingest
// notification) re-send the metric's current series + points via getMetric().
// The payload is bounded by maxMetricPoints x seriesCount, so it stays small.
//
//   - `metric-snapshot` : the full series+points for this metric
//   - `metric-removed`  : the metric no longer exists (cleared/deleted/evicted)
import { traceStore } from '$lib/server/traceStore'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params }) => {
  const metricId = params.metricId
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  // Assigned in start(); invoked from pull() when the consumer drains.
  let flushIfReady: (() => void) | null = null

  function cleanup() {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function serializeMetric() {
    // getMetricDetail flattens series + attaches per-second `rate` to Sum
    // points (cumulative w/ reset detection, or delta); other types pass
    // through with their type-appropriate point shape. Same shape as the
    // detail GET so the client can use one decoder for both.
    return traceStore.getMetricDetail(metricId) ?? null
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string): boolean => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
          return true
        } catch {
          cleanup()
          return false
        }
      }

      const sendSnapshot = () => {
        const metric = serializeMetric()
        if (!metric) {
          send('metric-removed', JSON.stringify({ id: metricId }))
          return
        }
        send('metric-snapshot', JSON.stringify(metric))
      }

      // Send current state immediately on connect.
      sendSnapshot()

      // Backpressure-aware flush: a web ReadableStream's enqueue() never blocks,
      // so if the client hasn't drained the previous snapshot we defer rather than
      // piling another full metric payload onto the unbounded off-heap queue. We
      // stay `dirty` and let pull() re-send once the consumer catches up. The
      // payload is a full, cursor-free snapshot, so a deferred tick loses nothing.
      let dirty = false
      const flush = () => {
        if (!dirty) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0) return
        dirty = false
        sendSnapshot()
      }
      flushIfReady = flush

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        dirty = true
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flush, 100)
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
    pull() {
      // Consumer drained and wants more — send a pending snapshot if deferred.
      flushIfReady?.()
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
