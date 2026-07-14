// Shared SSE event names used by both the stream server and client subscribers.
// Keep this list in sync with the events emitted by /api/stream.

export const SSE_EVENT_NAMES = [
  // full trace list (sent on connect and on every change)
  'traces',
  // current log count (tab badge)
  'logs-count',
  // full log list + cursor (connect / after clear/delete)
  'logs-snapshot',
  // only logs ingested since the client's cursor
  'logs-append',
] as const

export type SSEEventName = (typeof SSE_EVENT_NAMES)[number]
