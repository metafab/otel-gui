<script lang="ts">
  import { traceStore } from '$lib/stores/traces.svelte'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import ServiceMap from '$lib/components/ServiceMap.svelte'
  import { isInputFocused, isMac } from '$lib/utils/keyboard'
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte'
  import TraceFilters from '$lib/components/TraceFilters.svelte'
  import type { ServiceMapData } from '$lib/types'

  // Connect to SSE stream for real-time trace updates
  traceStore.connectSSE()

  // Reactive state from store
  const traces = $derived(traceStore.traces)
  const error = $derived(traceStore.error)
  const isLoading = $derived(traceStore.isLoading)
  const maxTraces = $derived(traceStore.maxTraces)

  // Tab navigation
  let activeTab = $state<'traces' | 'map'>('traces')

  // Service map state
  let serviceMapData = $state<ServiceMapData | null>(null)
  let serviceMapLoading = $state(false)
  let serviceMapError = $state<string | null>(null)

  async function fetchServiceMap() {
    serviceMapLoading = true
    serviceMapError = null
    try {
      const res = await fetch('/api/service-map')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      serviceMapData = await res.json()
    } catch (e) {
      serviceMapError = e instanceof Error ? e.message : String(e)
    } finally {
      serviceMapLoading = false
    }
  }

  // Re-fetch service map when switching to map tab or when traces update
  $effect(() => {
    if (activeTab === 'map') {
      // Re-fetch whenever trace count changes so the map stays current
      void traceStore.traces.length // reactive dependency
      fetchServiceMap()
    }
  })

  function handleMapNodeSelect(serviceName: string) {
    selectedService = serviceName
    activeTab = 'traces'
  }

  // Filter state
  let searchQuery = $state('')
  let selectedService = $state<string>('all')
  let searchInputEl = $state<HTMLInputElement | null>(null)
  let showShortcuts = $state(false)
  let showErrorsOnly = $state(false)
  let minDuration = $state<number | null>(null)
  let maxDuration = $state<number | null>(null)

  // Get unique services for filter dropdown
  const services = $derived(
    Array.from(new Set(traces.map((t) => t.serviceName))).sort(),
  )

  // Filtered traces
  const filteredTraces = $derived.by(() => {
    let result = traces

    // Search filter (trace ID, operation name, or service)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.traceId.toLowerCase().includes(query) ||
          t.rootSpanName.toLowerCase().includes(query) ||
          t.serviceName.toLowerCase().includes(query),
      )
    }

    // Service filter
    if (selectedService !== 'all') {
      result = result.filter((t) => t.serviceName === selectedService)
    }

    // Status filter
    if (showErrorsOnly) {
      result = result.filter((t) => t.hasError)
    }

    // Duration filter (with null checks)
    if (minDuration !== null && minDuration !== undefined) {
      const min = minDuration // Capture non-null value
      result = result.filter((t) => t.durationMs >= min)
    }
    if (maxDuration !== null && maxDuration !== undefined) {
      const max = maxDuration // Capture non-null value
      result = result.filter((t) => t.durationMs <= max)
    }

    return result
  })

  function handleClearFilters() {
    searchQuery = ''
    selectedService = 'all'
    showErrorsOnly = false
    minDuration = null
    maxDuration = null
  }

  function handleRowClick(traceId: string) {
    window.location.href = `/traces/${traceId}`
  }

  async function handleClearAll() {
    if (confirm('Clear all traces? This cannot be undone.')) {
      await traceStore.clearAllTraces()
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    // '/' focuses search (only when not in an input)
    if (e.key === '/' && !isInputFocused()) {
      e.preventDefault()
      searchInputEl?.focus()
      return
    }
    // Alt/Option+Delete: Clear All.
    // On macOS the ⌫ key fires e.key === "Backspace"; "Delete" is fn+⌫ (forward delete).
    // Check both so the shortcut works on all platforms.
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !isInputFocused()
    ) {
      e.preventDefault()
      handleClearAll()
      return
    }
    // Escape: clear search if input focused
    if (e.key === 'Escape' && isInputFocused()) {
      searchQuery = ''
      searchInputEl?.blur()
      return
    }
    // '?': toggle shortcuts help
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcuts = !showShortcuts
    }
    // 'm': toggle between Traces and Map tabs
    if (e.key === 'm' && !isInputFocused()) {
      e.preventDefault()
      activeTab = activeTab === 'traces' ? 'map' : 'traces'
    }
  }
</script>

<svelte:head>
  <title>otel-gui – {activeTab === 'map' ? 'Service Map' : 'Traces'}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="container">
  <header>
    <div class="tab-bar" role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === 'traces'}
        class="tab-btn"
        class:active={activeTab === 'traces'}
        onclick={() => (activeTab = 'traces')}
        >Traces {#if traces.length > 0}<span class="tab-count"
            >{traces.length}</span
          >{/if}</button
      >
      <button
        role="tab"
        aria-selected={activeTab === 'map'}
        class="tab-btn"
        class:active={activeTab === 'map'}
        onclick={() => (activeTab = 'map')}>Service Map</button
      >
    </div>
    <div class="actions">
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
      <button
        onclick={handleClearAll}
        disabled={isLoading || traces.length === 0}
      >
        Clear All
      </button>
    </div>
  </header>

  {#if activeTab === 'traces'}
    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if traces.length === 0}
      <div class="empty">
        <p>No traces received yet.</p>
        <p class="hint">
          Send OTLP traces to <code>http://localhost:4318/v1/traces</code>
        </p>
      </div>
    {:else}
      <TraceFilters
        {services}
        bind:searchQuery
        bind:selectedService
        bind:showErrorsOnly
        bind:minDuration
        bind:maxDuration
        bind:searchInputEl
        filteredCount={filteredTraces.length}
        totalCount={traces.length}
      />

      {#if filteredTraces.length === 0}
        <div class="empty">
          <p>No traces match the current filters.</p>
          <button onclick={handleClearFilters} class="clear-filters-btn">
            Clear Filters
          </button>
        </div>
      {:else}
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Root Service</th>
                <th>Root Name</th>
                <th>Root Duration</th>
                <th>Spans</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredTraces as trace (trace.traceId)}
                <tr
                  onclick={() => handleRowClick(trace.traceId)}
                  class:error={trace.hasError}
                >
                  <td><ServiceBadge serviceName={trace.serviceName} /></td>
                  <td class="operation" title={trace.rootSpanName}
                    >{trace.rootSpanName}</td
                  >
                  <td class="duration">{trace.durationMs.toFixed(2)}ms</td>
                  <td class="span-count">{trace.spanCount}</td>
                  <td class="timestamp" title={trace.startTime}>
                    {new Date(trace.startTime).toLocaleString()}
                  </td>
                  <td class="status">
                    {#if trace.hasError}
                      <span class="error-badge">ERROR</span>
                    {:else}
                      <span class="ok-badge">OK</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="retention-notice">
          Keeping last
          <span
            class="retention-limit"
            title="Set OTEL_GUI_MAX_TRACES=<number> (1–10 000) and restart to change this limit."
          >{maxTraces}</span> traces
        </p>
      {/if}
    {/if}
  {:else}
    <!-- Service Map tab -->
    <div class="map-content">
      {#if serviceMapLoading}
        <div class="map-status">Loading service map…</div>
      {:else if serviceMapError}
        <div class="error">{serviceMapError}</div>
      {:else if serviceMapData}
        <ServiceMap
          data={serviceMapData}
          onSelectService={handleMapNodeSelect}
        />
      {/if}
    </div>
  {/if}
</div>

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      { keys: ['/'], description: 'Focus search' },
      {
        keys: ['Esc'],
        description: 'Dismiss search (when search focused)',
      },
      {
        keys: [isMac ? 'Option+⌫' : 'Alt+Delete'],
        description: 'Clear all traces (opens confirm dialog)',
      },
      { keys: ['m'], description: 'Toggle Traces / Service Map tab' },
      { keys: ['?'], description: 'Toggle keyboard shortcuts help' },
    ]}
    onclose={() => (showShortcuts = false)}
  />
{/if}

<style>
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem 2rem 0;
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  /* Tab navigation */
  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    align-self: flex-end;
  }

  .tab-btn {
    padding: 0.5rem 1.25rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-secondary);
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--text-secondary);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
  }

  .tab-btn.active .tab-count {
    background: var(--accent-ring);
    color: var(--accent);
  }

  /* Service map container */
  .map-content {
    padding: 0;
  }

  .map-status {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .actions button:not(.shortcut-help-btn) {
    padding: 0.5rem 1rem;
    background: var(--error-border);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .actions button:not(.shortcut-help-btn):hover:not(:disabled) {
    background: var(--error-text);
  }

  .actions button:not(.shortcut-help-btn):disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    padding: 1rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 4px;
    color: var(--error-text);
    margin-bottom: 1rem;
  }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);
  }

  .empty p {
    margin: 0.5rem 0;
  }

  .empty code {
    background: var(--bg-muted);
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.875rem;
  }

  .table-wrapper {
    border-radius: 8px;
    box-shadow: 0 1px 3px var(--shadow);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    margin-bottom: 0.25rem;
  }

  .retention-notice {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: right;
    margin: 0.25rem 0 0.75rem;
  }

  .retention-limit {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: help;
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: var(--bg-surface);
    table-layout: fixed;
    min-width: 875px;
  }

  /* Fixed-width columns; Root Name (col 2) gets the remaining space with a min-width */
  th:nth-child(1) {
    width: 150px;
  }
  th:nth-child(2) {
    min-width: 200px;
  }
  th:nth-child(3) {
    width: 165px;
  }
  th:nth-child(4) {
    width: 90px;
  }
  th:nth-child(5) {
    width: 175px;
  }
  th:nth-child(6) {
    width: 95px;
  }

  thead {
    background: var(--bg-muted);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  th {
    text-align: left;
    padding: 0.5rem 1.25rem;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  tbody tr {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: var(--bg-surface-hover);
  }

  td {
    padding: 0.5rem 1.25rem;
    font-size: 0.875rem;
    border-top: 1px solid var(--border);
  }

  /* Error rows: coloured border on all four sides via per-cell borders */
  tbody tr.error {
    background: var(--error-bg-row);
  }

  tbody tr.error td {
    border-top: 1px solid var(--error-border);
    border-bottom: 1px solid var(--error-border);
  }

  tbody tr.error td:first-child {
    border-left: 1px solid var(--error-border);
  }

  tbody tr.error td:last-child {
    border-right: 1px solid var(--error-border);
  }

  /* Avoid doubled horizontal border between consecutive error rows */
  tbody tr.error + tr.error td {
    border-top: none;
  }

  tbody tr.error:hover {
    background: var(--error-bg-row-hover);
  }

  .operation {
    font-family: monospace;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    font-family: monospace;
    color: var(--accent);
    font-weight: 500;
  }

  .span-count {
    color: var(--text-secondary);
  }

  .timestamp {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .status {
    text-align: center;
  }

  .error-badge,
  .ok-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .error-badge {
    background: var(--error-bg);
    color: var(--error-text);
  }

  .ok-badge {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
</style>
