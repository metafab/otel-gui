// Unified SSE endpoint — multiplexes traces, logs, metrics, and the service map
// onto a SINGLE connection.
//
// Browsers cap HTTP/1.1 at ~6 connections per origin. Previously the app opened
// four separate SSE streams (/api/traces|logs|metrics|service-map/stream), each
// holding one connection open indefinitely, which left almost no room for
// regular fetches and stalled navigation. Every one of those streams subscribed
// to the same traceStore and its event names are already globally distinct, so
// they collapse cleanly into one connection here.
//
// Event types emitted (unchanged wire format — clients listen by name):
//   traces           : full trace list (sent on connect and on every change)
//   logs-count       : current log count (tab badge)
//   logs-snapshot    : full log list + cursor (connect / after clear/delete)
//   logs-append      : only logs ingested since the client's cursor
//   metrics-count    : current metric count (tab badge)
//   metrics-snapshot : full metric list + cursor (connect / after clear/delete)
//   metrics-append   : only metrics touched since the client's cursor
//   map-count        : current service-node count (tab badge)
//   map-snapshot     : full service map ({ nodes, edges })
import { traceStore } from '$lib/server/traceStore'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // Per-connection cursors, one set per multiplexed sub-stream.
  let lastLogSeq = 0
  let lastLogRemovalSeq = traceStore.getLogRemovalSeq()
  let lastMetricSeq = 0
  let lastMetricRemovalSeq = traceStore.getMetricRemovalSeq()
  let lastMapSeq = -1

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
        if (logs.length > 0) return send('logs-append', JSON.stringify({ logs }))
        return true
      }

      // ── metrics ───────────────────────────────────────────────────────────
      const sendMetricCount = () =>
        send('metrics-count', String(traceStore.getMetricCount()))

      const sendMetricSnapshot = () => {
        const metrics = traceStore.getMetricList(traceStore.maxMetrics)
        lastMetricSeq = traceStore.getMaxMetricSeq()
        lastMetricRemovalSeq = traceStore.getMetricRemovalSeq()
        return send('metrics-snapshot', JSON.stringify({ metrics }))
      }

      const sendMetricAppend = () => {
        const maxSeq = traceStore.getMaxMetricSeq()
        if (maxSeq <= lastMetricSeq) return true
        const metrics = traceStore.getMetricsSince(
          lastMetricSeq,
          traceStore.maxMetrics,
        )
        lastMetricSeq = maxSeq
        if (metrics.length > 0) {
          return send('metrics-append', JSON.stringify({ metrics }))
        }
        return true
      }

      // ── service map ─────────────────────────────────────────────────────
      const sendMapSnapshot = () => {
        const data = traceStore.getServiceMap()
        lastMapSeq = traceStore.getServiceMapSeq()
        send('map-count', String(data.nodes.length))
        return send('map-snapshot', JSON.stringify(data))
      }

      // Send full current state for every sub-stream on connect.
      sendTraces()
      sendLogCount()
      sendLogSnapshot()
      sendMetricCount()
      sendMetricSnapshot()
      sendMapSnapshot()

      // Debounce rapid-fire ingestion (batched exports can arrive all at once).
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unsubscribe = traceStore.subscribe(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
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

          // metrics: same delta protocol as logs.
          if (!sendMetricCount()) return
          if (traceStore.getMetricRemovalSeq() !== lastMetricRemovalSeq) {
            if (!sendMetricSnapshot()) return
          } else if (!sendMetricAppend()) {
            return
          }

          // service map: small derived aggregate — re-send only when it changed.
          if (traceStore.getServiceMapSeq() !== lastMapSeq) {
            if (!sendMapSnapshot()) return
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
