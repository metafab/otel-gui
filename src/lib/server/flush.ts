// Flush every telemetry buffer at once — traces, logs, metrics, and (via
// clearTraces) the cumulative service map. The intended workflow is to flush,
// run a specific activity, then investigate from a clean slate so everything
// left in the store relates to that activity.
//
// Shared by POST /api/flush (front-end button) and the MCP `flush` tool so the
// behaviour is identical however it's triggered. Clearing notifies SSE
// subscribers, so every live view re-snapshots to empty on its own.
import type { TraceStore } from '$lib/types'

export interface FlushResult {
  traces: number
  logs: number
  metrics: number
}

// Returns the pre-clear counts so the caller can report what was dropped.
export function flushTelemetry(store: TraceStore): FlushResult {
  const cleared: FlushResult = {
    traces: store.getTraceCount(),
    logs: store.getLogCount(),
    metrics: store.getMetricCount(),
  }
  // clearTraces also resets the cumulative service-map aggregate.
  store.clearTraces()
  store.clearLogs()
  store.clearMetrics()
  return cleared
}
