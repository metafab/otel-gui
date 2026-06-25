// Client-side reactive store for the global service map using Svelte 5 runes.
// Mirrors the logs/metrics SSE pattern: it subscribes to the map stream and
// holds the latest snapshot in memory, so the view updates push-driven and
// flash-free (only the very first snapshot toggles isLoading).
//
// Layout stability ("don't reflow on every change") is handled separately in
// the render layer (createStickyLayout in $lib/utils/graph) — this store only
// carries the raw nodes/edges + counts.
import type { ServiceMapData } from '$lib/types'

const EMPTY: ServiceMapData = { nodes: [], edges: [] }

let data = $state.raw<ServiceMapData>(EMPTY)
let count = $state<number>(0)
let isLoading = $state<boolean>(true)
let error = $state<string | null>(null)

// Connect to the SSE stream — receives the full map + count in real-time and on
// every change. Call once from a component's reactive scope (e.g. the map tab).
function connectSSE() {
  $effect(() => {
    if (typeof EventSource === 'undefined') {
      // No EventSource (SSR/legacy) — one-shot REST load as a fallback.
      void loadMap()
      return
    }

    const es = new EventSource('/api/service-map/stream')

    es.addEventListener('map-count', (event: MessageEvent) => {
      const parsed = Number.parseInt(event.data, 10)
      if (!Number.isNaN(parsed)) count = parsed
    })

    // Full map: sent on connect and on every change to the cumulative aggregate.
    es.addEventListener('map-snapshot', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data)
        data = {
          nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed.edges) ? parsed.edges : [],
        }
        error = null
      } catch {
        // Ignore malformed payloads; the next snapshot will re-sync.
      } finally {
        isLoading = false
      }
    })

    es.onerror = () => {
      // EventSource auto-reconnects; the reconnect replays a fresh snapshot.
    }

    return () => es.close()
  })
}

// Fallback for environments without EventSource.
async function loadMap() {
  isLoading = true
  error = null
  try {
    const response = await fetch('/api/service-map')
    if (!response.ok) {
      throw new Error(`Failed to load service map: ${response.statusText}`)
    }
    const parsed = await response.json()
    data = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
    count = data.nodes.length
  } catch (err) {
    error =
      err instanceof Error ? err.message : 'Unknown error loading service map'
    data = EMPTY
  } finally {
    isLoading = false
  }
}

// Export reactive getters and actions
export const serviceMapStore = {
  get data() {
    return data
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
  connectSSE,
  loadMap,
}
