// Shared client-side SSE connection.
//
// The whole app streams over ONE EventSource('/api/stream') instead of opening
// a separate connection per view (traces / logs). That kept several of the
// browser's ~6-connection-per-origin budget permanently occupied and starved
// regular fetches + navigation. Here, every store/view registers its listeners
// on a single connection via onSSE().
//
// The connection is opened lazily on the first subscription and kept alive for
// the app's lifetime (it's a single connection, so there's no benefit to
// churning it closed/open as views mount and unmount — which is exactly the
// thrash we're avoiding). Listeners are added/removed per subscriber so a
// remounted component never double-processes events.

import type { SSEEventName } from '$lib/utils/sseEvents'

type SSEHandler = (event: MessageEvent) => void

type SSEHandlerMap = Partial<Record<SSEEventName, SSEHandler>>

let connection: EventSource | null = null

function getConnection(): EventSource | null {
  // SSR / legacy environments have no EventSource — callers fall back to REST.
  if (typeof EventSource === 'undefined') return null
  if (connection === null) {
    connection = new EventSource('/api/stream')
    connection.onerror = () => {
      // EventSource auto-reconnects on its own; on reconnect the server replays
      // a fresh snapshot for every sub-stream, so no manual resync is needed.
    }
  }
  return connection
}

/**
 * Subscribe to a named SSE event on the shared app-wide connection. Returns an
 * unsubscribe function that removes the listener. Returns a no-op unsubscribe
 * when EventSource is unavailable (SSR/legacy).
 */
export function onSSE(event: SSEEventName, handler: SSEHandler): () => void {
  const conn = getConnection()
  if (conn === null) return () => {}
  conn.addEventListener(event, handler as EventListener)
  return () => {
    if (typeof conn.removeEventListener === 'function') {
      conn.removeEventListener(event, handler as EventListener)
    }
  }
}

/**
 * Subscribe to several named SSE events at once. Returns a single unsubscribe
 * function that removes all of them — convenient for a store/effect that
 * listens to a snapshot + append + count triplet.
 */
export function onSSEEvents(handlers: SSEHandlerMap): () => void {
  const offs = Object.entries(handlers).map(([event, handler]) =>
    onSSE(event as SSEEventName, handler),
  )
  return () => {
    for (const off of offs) off()
  }
}

/**
 * Test-only helper: force-close and reset the shared connection so each test
 * starts from a clean slate.
 */
export function __resetSSEConnectionForTests(): void {
  connection?.close()
  connection = null
}
