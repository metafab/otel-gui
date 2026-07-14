// Unified SSE endpoint — multiplexes traces and logs onto a SINGLE connection.
//
// Browsers cap HTTP/1.1 at ~6 connections per origin. Previously the app opened
// a separate SSE stream per signal (/api/traces|logs/stream), each holding one
// connection open indefinitely, which left almost no room for regular fetches
// and stalled navigation. Every one of those streams subscribed to the same
// traceStore and its event names are already globally distinct, so they
// collapse cleanly into one connection here.

import { traceStore } from '$lib/server/traceStore'
import type { SSEEventName } from '$lib/utils/sseEvents'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  // Assigned in start(); invoked from pull() when the consumer drains so pending
  // changes are flushed as soon as the client can accept them again.
  let flushIfReady: (() => void) | null = null

  // Per-connection cursors, one set per multiplexed sub-stream.
  let lastLogSeq = 0
  let lastLogRemovalSeq = traceStore.getLogRemovalSeq()

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
      const send = (event: SSEEventName, data: string): boolean => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
          )
          return true
        } catch {
          // Controller already closed (client disconnected).
          cleanup()
          return false
        }
      }

      // ── traces ────────────────────────────────────────────────────────────
      const sendTraces = () => {
        const data =
          traceStore.getTraceCount() === 0
            ? '[]'
            : JSON.stringify(traceStore.getTraceList(traceStore.maxTraces))
        return send('traces', data)
      }

      // ── logs ──────────────────────────────────────────────────────────────
      const sendLogCount = () =>
        send('logs-count', String(traceStore.getLogCount()))

      const sendLogSnapshot = () => {
        const logs = traceStore.getLogList(traceStore.maxLogs)
        lastLogSeq = traceStore.getMaxLogSeq()
        lastLogRemovalSeq = traceStore.getLogRemovalSeq()
        return send('logs-snapshot', JSON.stringify({ logs }))
      }

      const sendLogAppend = () => {
        const maxSeq = traceStore.getMaxLogSeq()
        if (maxSeq <= lastLogSeq) return true
        const logs = traceStore.getLogsSince(lastLogSeq, traceStore.maxLogs)
        lastLogSeq = maxSeq
        if (logs.length > 0)
          return send('logs-append', JSON.stringify({ logs }))
        return true
      }

      // Send full current state for every sub-stream on connect.
      sendTraces()
      sendLogCount()
      sendLogSnapshot()

      // Backpressure-aware flush. A web ReadableStream's enqueue() never blocks —
      // it just drives desiredSize negative and keeps buffering the encoded bytes
      // off-heap. So we only flush when the consumer has drained enough to accept
      // more (desiredSize > 0); otherwise we stay `dirty` and let pull() re-invoke
      // us the moment the client catches up. Pending logs sit in the
      // bounded store (never an unbounded socket queue) until then, so nothing is
      // dropped and off-heap memory stays bounded to ~one flush.
      let dirty = false
      const flush = () => {
        if (!dirty) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0)
          return
        dirty = false

        // traces: always full list (matches the previous per-stream behavior).
        if (!sendTraces()) return

        // logs: re-snapshot on clear/delete (cursor can't express removals),
        // otherwise stream only the new logs.
        if (!sendLogCount()) return
        if (traceStore.getLogRemovalSeq() !== lastLogRemovalSeq) {
          if (!sendLogSnapshot()) return
        } else if (!sendLogAppend()) {
          return
        }
      }
      flushIfReady = flush

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      // `dirty` is set synchronously so a pull() during a debounce window still
      // sees pending work.
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
      // The runtime calls pull() when the consumer has drained the queue and
      // wants more (desiredSize > 0). Flush anything that backpressure deferred.
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
