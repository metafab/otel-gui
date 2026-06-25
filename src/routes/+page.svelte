<script lang="ts">
  import { pushState } from '$app/navigation'
  import { tick } from 'svelte'
  import { page } from '$app/stores'
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte'
  import Logs from '$lib/components/Logs.svelte'
  import LogsCommands from '$lib/components/LogsCommands.svelte'
  import Metrics from '$lib/components/Metrics.svelte'
  import MetricsCommands from '$lib/components/MetricsCommands.svelte'
  import ServiceMap from '$lib/components/ServiceMap.svelte'
  import TracesCommands from '$lib/components/TracesCommands.svelte'
  import Traces from '$lib/components/Traces.svelte'
  import { metricStore } from '$lib/stores/metrics.svelte'
  import { traceStore } from '$lib/stores/traces.svelte'
  import type { ServiceMapData } from '$lib/types'
  import { isInputFocused, isMac } from '$lib/utils/keyboard'

  // Connect to SSE stream for real-time trace updates
  traceStore.connectSSE()
  // Connect to the metrics list stream — drives the tab count badge.
  metricStore.connectSSE()

  function connectLogsCountSSE() {
    $effect(() => {
      if (typeof EventSource === 'undefined') return

      const es = new EventSource('/api/logs/stream')

      es.addEventListener('logs-count', (event: MessageEvent) => {
        const parsed = Number.parseInt(event.data, 10)
        if (!Number.isNaN(parsed)) {
          logsBadgeTotal = parsed
        }
      })

      es.onerror = () => {
        // EventSource auto-reconnects.
      }

      return () => es.close()
    })
  }

  connectLogsCountSSE()

  // Reactive state from store (for tab count badge only)
  const traces = $derived(traceStore.traces)
  const metricsBadgeTotal = $derived(metricStore.count)

  // Tab navigation
  const initialTab = $page.url.searchParams.get('tab')
  let activeTab = $state<'traces' | 'logs' | 'metrics' | 'map'>(
    initialTab === 'map' || initialTab === 'logs' || initialTab === 'metrics'
      ? initialTab
      : 'traces',
  )

  // Store the last URL for each tab to restore when switching back.
  let tabUrlMap = $state<Record<'traces' | 'logs' | 'metrics' | 'map', string>>(
    {
      traces: '/',
      logs: '/?tab=logs',
      metrics: '/?tab=metrics',
      map: '/?tab=map',
    },
  )

  function tabFromUrl(url: URL): 'traces' | 'logs' | 'metrics' | 'map' {
    const tab = url.searchParams.get('tab')
    return tab === 'map' || tab === 'logs' || tab === 'metrics' ? tab : 'traces'
  }

  async function switchTab(nextTab: 'traces' | 'logs' | 'metrics' | 'map') {
    if (typeof window === 'undefined' || nextTab === activeTab) return

    // Let pending child effects flush URL filter changes before snapshotting.
    await tick()

    const currentUrl = new URL(window.location.href)
    const currentTab = tabFromUrl(currentUrl)
    tabUrlMap[currentTab] = currentUrl.href

    const nextUrl = new URL(tabUrlMap[nextTab], window.location.origin)
    if (nextUrl.href !== window.location.href) {
      pushState(nextUrl, {})
    }

    activeTab = nextTab
  }

  // Seed current tab URL so first switch can restore accurately.
  $effect(() => {
    if (typeof window === 'undefined') return
    const currentUrl = new URL(window.location.href)
    tabUrlMap[tabFromUrl(currentUrl)] = currentUrl.href
  })

  // Sync URL changes (back/forward) to active tab.
  $effect(() => {
    if (typeof window === 'undefined') return

    function handlePopState() {
      const url = new URL(window.location.href)
      const tab = tabFromUrl(url)
      tabUrlMap[tab] = url.href
      activeTab = tab
    }

    window.addEventListener('popstate', handlePopState)

    return () => window.removeEventListener('popstate', handlePopState)
  })

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

  $effect(() => {
    if (activeTab === 'map') {
      void traceStore.traces.length // reactive dependency
      fetchServiceMap()
    }
  })

  let tracesRef: {
    setSelectedService: (name: string) => void
    openImportModal: () => void
    triggerExportFiltered: () => void
    triggerExportSelected: () => void
    triggerClearAll: () => void
    triggerDeleteSelected: () => void
  } | null = $state(null)

  // Reactive state exposed from Traces for action button disabled states
  let filteredCount = $state(0)
  let selectedCount = $state(0)
  let isExporting = $state(false)

  // Logs ref and reactive state for LogsCommands
  let logsRef: {
    triggerClearAll: () => void
    triggerDeleteSelected: () => void
  } | null = $state(null)
  let logsTotal = $state(0)
  let logsBadgeTotal = $state(0)
  let logsSelected = $state(0)
  let logsDeleting = $state(false)

  // Metrics ref and reactive state for MetricsCommands
  let metricsRef: {
    triggerClearAll: () => void
    triggerDeleteSelected: () => void
  } | null = $state(null)
  let metricsTotal = $state(0)
  let metricsSelected = $state(0)
  let metricsDeleting = $state(false)

  function handleMapNodeSelect(serviceName: string) {
    switchTab('traces')
    tracesRef?.setSelectedService(serviceName)
  }

  let showShortcuts = $state(false)

  function handleGlobalKeydown(e: KeyboardEvent) {
    // '?': toggle shortcuts help
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcuts = !showShortcuts
      return
    }

    // 't': switch directly to Traces tab
    if (e.key === 't' && !isInputFocused()) {
      e.preventDefault()
      switchTab('traces')
      return
    }

    // 'l': switch directly to Logs tab
    if (e.key === 'l' && !isInputFocused()) {
      e.preventDefault()
      switchTab('logs')
      return
    }

    // 'c': switch directly to Metrics tab ("counters"; t/l/m are taken)
    if (e.key === 'c' && !isInputFocused()) {
      e.preventDefault()
      switchTab('metrics')
      return
    }

    // 'm': switch to Map tab
    if (e.key === 'm' && !isInputFocused()) {
      e.preventDefault()
      switchTab('map')
      return
    }
  }
</script>

<svelte:head>
  <title
    >otel-gui – {activeTab === 'map'
      ? 'Service Map'
      : activeTab === 'logs'
        ? 'Logs'
        : activeTab === 'metrics'
          ? 'Metrics'
          : 'Traces'}</title
  >
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
        onclick={() => switchTab('traces')}
        >Traces {#if traces.length > 0}<span class="tab-count"
            >{traces.length}</span
          >{/if}</button
      >
      <button
        role="tab"
        aria-selected={activeTab === 'logs'}
        class="tab-btn"
        class:active={activeTab === 'logs'}
        onclick={() => switchTab('logs')}
        >Logs {#if logsBadgeTotal > 0}<span class="tab-count"
            >{logsBadgeTotal}</span
          >{/if}</button
      >
      <button
        role="tab"
        aria-selected={activeTab === 'metrics'}
        class="tab-btn"
        class:active={activeTab === 'metrics'}
        onclick={() => switchTab('metrics')}
        >Metrics {#if metricsBadgeTotal > 0}<span class="tab-count"
            >{metricsBadgeTotal}</span
          >{/if}</button
      >
      <button
        role="tab"
        aria-selected={activeTab === 'map'}
        class="tab-btn"
        class:active={activeTab === 'map'}
        onclick={() => switchTab('map')}>Service Map</button
      >
    </div>
    <div class="actions">
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
      {#if activeTab === 'traces'}
        <TracesCommands
          {filteredCount}
          {selectedCount}
          totalCount={traces.length}
          {isExporting}
          onImport={() => tracesRef?.openImportModal()}
          onExportFiltered={() => tracesRef?.triggerExportFiltered()}
          onExportSelected={() => tracesRef?.triggerExportSelected()}
          onClearAll={() => tracesRef?.triggerClearAll()}
          onDeleteSelected={() => tracesRef?.triggerDeleteSelected()}
        />
      {:else if activeTab === 'logs'}
        <LogsCommands
          totalCount={logsTotal}
          selectedCount={logsSelected}
          isDeleting={logsDeleting}
          onClearAll={() => logsRef?.triggerClearAll()}
          onDeleteSelected={() => logsRef?.triggerDeleteSelected()}
        />
      {:else if activeTab === 'metrics'}
        <MetricsCommands
          totalCount={metricsTotal}
          selectedCount={metricsSelected}
          isDeleting={metricsDeleting}
          onClearAll={() => metricsRef?.triggerClearAll()}
          onDeleteSelected={() => metricsRef?.triggerDeleteSelected()}
        />
      {/if}
    </div>
  </header>

  {#if activeTab === 'traces'}
    <Traces
      bind:this={tracesRef}
      bind:filteredCount
      bind:selectedCount
      bind:isExportingBound={isExporting}
    />
  {:else if activeTab === 'logs'}
    <div class="logs-tab" role="region" aria-label="Logs">
      <Logs
        bind:this={logsRef}
        bind:totalCount={logsTotal}
        bind:selectedCount={logsSelected}
        bind:isDeletingBound={logsDeleting}
      />
    </div>
  {:else if activeTab === 'metrics'}
    <div class="metrics-tab" role="region" aria-label="Metrics">
      <Metrics
        bind:this={metricsRef}
        bind:totalCount={metricsTotal}
        bind:selectedCount={metricsSelected}
        bind:isDeletingBound={metricsDeleting}
      />
    </div>
  {:else}
    <!-- Service Map tab -->
    <div class="map-content">
      {#if serviceMapLoading}
        <div class="map-status">Loading service map…</div>
      {:else if serviceMapError}
        <div class="map-error">{serviceMapError}</div>
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
      { keys: ['t'], description: 'Switch to Traces tab' },
      { keys: ['l'], description: 'Switch to Logs tab' },
      { keys: ['c'], description: 'Switch to Metrics tab' },
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

  .map-error {
    padding: 1rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 4px;
    color: var(--error-text);
    margin-bottom: 1rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .logs-tab,
  .metrics-tab {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
