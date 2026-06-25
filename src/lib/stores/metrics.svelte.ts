// Client-side reactive store for the metric LIST using Svelte 5 runes.
// Mirrors traces.svelte.ts but for metrics: it mirrors the SSE list stream
// (metrics-snapshot / metrics-append) in memory, exactly like the Logs view,
// so the list is flash-free (only the very first snapshot toggles isLoading).
import type { MetricListItem } from '$lib/types'

// State management
let metrics = $state.raw<MetricListItem[]>([])
let count = $state<number>(0)
let isLoading = $state<boolean>(true)
let error = $state<string | null>(null)
let maxMetrics = $state<number>(1000)

// Merge newly-streamed metrics into the existing list (upsert by id) without
// refetching everything. The server already bounds the set to maxMetrics.
function applyAppend(incoming: MetricListItem[]) {
  if (incoming.length === 0) return

  const byId = new Map<string, MetricListItem>()
  for (const m of metrics) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)

  // Newest-first by lastUpdated, mirroring the server's list ordering.
  metrics = Array.from(byId.values()).sort(
    (a, b) => b.lastUpdated - a.lastUpdated,
  )
}

// Connect to SSE stream — receives the metric list + count in real-time.
function connectSSE() {
  $effect(() => {
    // Fetch server config once on mount (for the retention badge).
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (typeof cfg.maxMetrics === 'number') maxMetrics = cfg.maxMetrics
      })
      .catch(() => {}) // non-critical, keep default

    if (typeof EventSource === 'undefined') {
      // No EventSource (SSR/legacy) — one-shot REST load as a fallback.
      void loadMetrics()
      return
    }

    const es = new EventSource('/api/metrics/stream')

    es.addEventListener('metrics-count', (event: MessageEvent) => {
      const parsed = Number.parseInt(event.data, 10)
      if (!Number.isNaN(parsed)) count = parsed
    })

    // Full list: sent on connect and after any clear/delete (re-sync).
    es.addEventListener('metrics-snapshot', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        metrics = Array.isArray(data.metrics) ? data.metrics : []
        error = null
      } catch {
        // Ignore malformed payloads; the next snapshot will re-sync.
      } finally {
        isLoading = false
      }
    })

    // Incremental: only metrics touched since the last cursor. Merged in place
    // so the table updates without a full re-render (no flash).
    es.addEventListener('metrics-append', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (Array.isArray(data.metrics)) applyAppend(data.metrics)
      } catch {
        // Ignore malformed payloads.
      }
    })

    es.onerror = () => {
      // EventSource auto-reconnects; the reconnect replays a fresh snapshot.
    }

    return () => es.close()
  })
}

// Fallback for environments without EventSource.
async function loadMetrics() {
  isLoading = true
  error = null
  try {
    const response = await fetch('/api/metrics?limit=5000')
    if (!response.ok) {
      throw new Error(`Failed to load metrics: ${response.statusText}`)
    }
    metrics = await response.json()
    count = metrics.length
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error loading metrics'
    metrics = []
  } finally {
    isLoading = false
  }
}

// Clear all metrics
async function clearAllMetrics() {
  try {
    error = null
    const response = await fetch('/api/metrics', { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(`Failed to clear metrics: ${response.statusText}`)
    }
    metrics = []
    count = 0
  } catch (err) {
    error =
      err instanceof Error ? err.message : 'Unknown error clearing metrics'
    console.error('Error clearing metrics:', err)
  }
}

// Delete a selected subset of metrics by id.
async function deleteSelectedMetrics(ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0
  }

  try {
    error = null
    const response = await fetch('/api/metrics', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    })
    if (!response.ok) {
      throw new Error(
        `Failed to delete selected metrics: ${response.statusText}`,
      )
    }

    const payload = await response.json()
    const deletedCount =
      typeof payload.deletedCount === 'number' ? payload.deletedCount : 0

    if (deletedCount > 0) {
      const removed = new Set(ids)
      metrics = metrics.filter((m) => !removed.has(m.id))
      count = metrics.length
    }

    return deletedCount
  } catch (err) {
    error =
      err instanceof Error ? err.message : 'Unknown error deleting metrics'
    console.error('Error deleting selected metrics:', err)
    return 0
  }
}

// Export reactive getters and actions
export const metricStore = {
  get metrics() {
    return metrics
  },
  get count() {
    return count
  },
  get isLoading() {
    return isLoading
  },
  get error() {
    return error
  },
  get maxMetrics() {
    return maxMetrics
  },
  connectSSE,
  loadMetrics,
  clearAllMetrics,
  deleteSelectedMetrics,
}
