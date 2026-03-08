// Client-side reactive store for traces using Svelte 5 runes
import type {
  TraceListItem,
  StoredTrace,
  TraceLogListItem,
  TraceLogDetail,
} from '$lib/types'

interface PersistenceConfig {
  mode: 'memory' | 'pglite'
  enabled: boolean
  backend: 'pglite' | null
  path: string | null
  flushMs: number | null
  lastRestoreAt: string | null
  restoredTraceCount: number
  pendingFlushCount: number
}

// State management
let traces = $state.raw<TraceListItem[]>([])
let selectedId = $state<string | null>(null)
let isLoading = $state<boolean>(false)
let error = $state<string | null>(null)
let maxTraces = $state<number>(1000)
let persistence = $state<PersistenceConfig>({
  mode: 'memory',
  enabled: false,
  backend: null,
  path: null,
  flushMs: null,
  lastRestoreAt: null,
  restoredTraceCount: 0,
  pendingFlushCount: 0,
})

// Derived state
const selected = $derived(traces.find((t) => t.traceId === selectedId) || null)

// Connect to SSE stream — receives trace list pushes in real-time
function connectSSE() {
  $effect(() => {
    // Fetch server config once on mount
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (typeof cfg.maxTraces === 'number') maxTraces = cfg.maxTraces
        if (cfg.persistence && typeof cfg.persistence === 'object') {
          persistence = {
            mode: cfg.persistence.mode === 'pglite' ? 'pglite' : 'memory',
            enabled: cfg.persistence.enabled === true,
            backend: cfg.persistence.backend === 'pglite' ? 'pglite' : null,
            path:
              typeof cfg.persistence.path === 'string'
                ? cfg.persistence.path
                : null,
            flushMs:
              typeof cfg.persistence.flushMs === 'number'
                ? cfg.persistence.flushMs
                : null,
            lastRestoreAt:
              typeof cfg.persistence.lastRestoreAt === 'string'
                ? cfg.persistence.lastRestoreAt
                : null,
            restoredTraceCount:
              typeof cfg.persistence.restoredTraceCount === 'number'
                ? cfg.persistence.restoredTraceCount
                : 0,
            pendingFlushCount:
              typeof cfg.persistence.pendingFlushCount === 'number'
                ? cfg.persistence.pendingFlushCount
                : 0,
          }
        }
      })
      .catch(() => {}) // non-critical, keep default
    const es = new EventSource('/api/traces/stream')

    es.addEventListener('traces', (event: MessageEvent) => {
      traces = JSON.parse(event.data)
      error = null
    })

    es.addEventListener('open', () => {
      error = null
    })

    es.onerror = () => {
      // EventSource auto-reconnects — note it but don't surface as fatal
      console.warn('SSE connection lost, reconnecting...')
    }

    return () => es.close()
  })
}

// Fetch single trace detail
async function fetchTrace(traceId: string): Promise<StoredTrace | null> {
  try {
    isLoading = true
    error = null
    const response = await fetch(`/api/traces/${traceId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch trace: ${response.statusText}`)
    }
    const data = await response.json()
    return data
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error fetching trace'
    console.error('Error fetching trace:', err)
    return null
  } finally {
    isLoading = false
  }
}

async function fetchTraceLogs(
  traceId: string,
  options?: { limit?: number; spanId?: string },
): Promise<TraceLogListItem[]> {
  try {
    isLoading = true
    error = null

    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.spanId) params.set('spanId', options.spanId)
    const query = params.toString()

    const response = await fetch(
      `/api/traces/${traceId}/logs${query ? `?${query}` : ''}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch trace logs: ${response.statusText}`)
    }

    return await response.json()
  } catch (err) {
    error =
      err instanceof Error ? err.message : 'Unknown error fetching trace logs'
    console.error('Error fetching trace logs:', err)
    return []
  } finally {
    isLoading = false
  }
}

async function fetchTraceLog(
  traceId: string,
  logId: string,
): Promise<TraceLogDetail | null> {
  try {
    isLoading = true
    error = null
    const response = await fetch(`/api/traces/${traceId}/logs/${logId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch trace log: ${response.statusText}`)
    }
    return await response.json()
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error fetching log'
    console.error('Error fetching trace log:', err)
    return null
  } finally {
    isLoading = false
  }
}

// Select a trace by ID
function selectTrace(traceId: string | null) {
  selectedId = traceId
}

// Clear all traces
async function clearAllTraces() {
  try {
    isLoading = true
    error = null
    const response = await fetch('/api/traces', { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(`Failed to clear traces: ${response.statusText}`)
    }
    traces = []
    selectedId = null
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error clearing traces'
    console.error('Error clearing traces:', err)
  } finally {
    isLoading = false
  }
}

// Export reactive getters and actions
export const traceStore = {
  get traces() {
    return traces
  },
  get selected() {
    return selected
  },
  get selectedId() {
    return selectedId
  },
  get isLoading() {
    return isLoading
  },
  get error() {
    return error
  },
  get maxTraces() {
    return maxTraces
  },
  get persistence() {
    return persistence
  },
  fetchTrace,
  fetchTraceLogs,
  fetchTraceLog,
  selectTrace,
  clearAllTraces,
  connectSSE,
}
