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

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          sendSnapshot()
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
