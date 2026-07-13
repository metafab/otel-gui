<script lang="ts">
  import { replaceState } from '$app/navigation'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import TraceFilters from '$lib/components/TraceFilters.svelte'
  import TraceImportModal from '$lib/components/TraceImportModal.svelte'
  import VersionInfo from '$lib/components/VersionInfo.svelte'
  import { traceStore } from '$lib/stores/traces.svelte'
  import { isInputFocused } from '$lib/utils/keyboard'
  import { formatDurationFromMs } from '$lib/utils/time'

  // Bindable props so parent can read reactive state for header action buttons
  let {
    filteredCount = $bindable(0),
    selectedCount = $bindable(0),
    isExportingBound = $bindable(false),
  } = $props()

  const traces = $derived(traceStore.traces)
  const tracesLoaded = $derived(traceStore.tracesLoaded)
  const error = $derived(traceStore.error)
  const maxTraces = $derived(traceStore.maxTraces)
  const persistence = $derived(traceStore.persistence)

  const otlpEndpoint = $derived.by(() => {
    if (typeof window !== 'undefined') {
      const { protocol, hostname, port } = window.location
      return `${protocol}//${hostname}${port ? ':' + port : ''}/v1/traces`
    }
    return 'http://localhost:4318/v1/traces'
  })

  type TraceSortBy =
    | 'rootService'
    | 'rootName'
    | 'duration'
    | 'spans'
    | 'logs'
    | 'time'
    | 'status'
  type TraceSortOrder = 'asc' | 'desc'

  const DEFAULT_SORT_BY: TraceSortBy = 'time'
  const DEFAULT_SORT_ORDER: TraceSortOrder = 'desc'

  function parseSortBy(rawValue: string | null): TraceSortBy {
    switch (rawValue) {
      case 'rootService':
      case 'rootName':
      case 'duration':
      case 'spans':
      case 'logs':
      case 'time':
      case 'status':
        return rawValue
      default:
        return DEFAULT_SORT_BY
    }
  }

  function parseSortOrder(rawValue: string | null): TraceSortOrder {
    return rawValue === 'asc' || rawValue === 'desc'
      ? rawValue
      : DEFAULT_SORT_ORDER
  }

  function parseFilterNumber(rawValue: string | null): number | null {
    if (!rawValue) return null
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null
  }

  function readFilterParams(url: URL) {
    return {
      searchQuery: url.searchParams.get('search') ?? '',
      selectedService: url.searchParams.get('service') ?? 'all',
      showErrorsOnly: url.searchParams.get('errors') === 'true',
      minDuration: parseFilterNumber(url.searchParams.get('minDuration')),
      maxDuration: parseFilterNumber(url.searchParams.get('maxDuration')),
      sortBy: parseSortBy(url.searchParams.get('sort')),
      sortOrder: parseSortOrder(url.searchParams.get('order')),
    } as const
  }

  function applyFilterParams(url: URL) {
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery)
    } else {
      url.searchParams.delete('search')
    }

    if (selectedService !== 'all') {
      url.searchParams.set('service', selectedService)
    } else {
      url.searchParams.delete('service')
    }

    if (showErrorsOnly) {
      url.searchParams.set('errors', 'true')
    } else {
      url.searchParams.delete('errors')
    }

    if (minDuration !== null) {
      url.searchParams.set('minDuration', String(minDuration))
    } else {
      url.searchParams.delete('minDuration')
    }

    if (maxDuration !== null) {
      url.searchParams.set('maxDuration', String(maxDuration))
    } else {
      url.searchParams.delete('maxDuration')
    }

    if (sortBy === DEFAULT_SORT_BY && sortOrder === DEFAULT_SORT_ORDER) {
      url.searchParams.delete('sort')
      url.searchParams.delete('order')
    } else {
      url.searchParams.set('sort', sortBy)
      url.searchParams.set('order', sortOrder)
    }
  }

  const initialFilterUrl =
    typeof window !== 'undefined'
      ? new URL(window.location.href)
      : new URL('http://localhost/')
  const initialFilters = readFilterParams(initialFilterUrl)

  let searchQuery = $state(initialFilters.searchQuery)
  let selectedService = $state<string>(initialFilters.selectedService)
  let searchInputEl = $state<HTMLInputElement | null>(null)
  let showImportModal = $state(false)
  let importSuccessMessage = $state<string | null>(null)
  let exportError = $state<string | null>(null)
  let isExporting = $state(false)
  let selectedTraceIds = $state<string[]>([])
  let showErrorsOnly = $state(initialFilters.showErrorsOnly)
  let minDuration = $state<number | null>(initialFilters.minDuration)
  let maxDuration = $state<number | null>(initialFilters.maxDuration)
  let sortBy = $state<TraceSortBy>(initialFilters.sortBy)
  let sortOrder = $state<TraceSortOrder>(initialFilters.sortOrder)

  const services = $derived(
    Array.from(new Set(traces.map((t) => t.serviceName))).sort(),
  )

  $effect(() => {
    if (selectedService === 'all' || services.length === 0) return
    if (!services.includes(selectedService)) {
      selectedService = 'all'
    }
  })

  const filteredTraces = $derived.by(() => {
    let result = traces

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.traceId.toLowerCase().includes(query) ||
          t.rootSpanName.toLowerCase().includes(query) ||
          t.serviceName.toLowerCase().includes(query),
      )
    }

    if (selectedService !== 'all') {
      result = result.filter((t) => t.serviceName === selectedService)
    }

    if (showErrorsOnly) {
      result = result.filter((t) => t.hasError)
    }

    if (minDuration !== null && minDuration !== undefined) {
      const min = minDuration
      result = result.filter((t) => t.durationMs >= min)
    }
    if (maxDuration !== null && maxDuration !== undefined) {
      const max = maxDuration
      result = result.filter((t) => t.durationMs <= max)
    }

    const sorted = [...result].sort((a, b) => {
      let directionlessResult = 0

      switch (sortBy) {
        case 'rootService':
          directionlessResult = a.serviceName.localeCompare(b.serviceName)
          break
        case 'duration':
          directionlessResult = a.durationMs - b.durationMs
          break
        case 'spans':
          directionlessResult = a.spanCount - b.spanCount
          break
        case 'logs':
          directionlessResult = (a.logCount ?? 0) - (b.logCount ?? 0)
          break
        case 'time':
          directionlessResult = a.startTime.localeCompare(b.startTime)
          break
        case 'rootName':
          directionlessResult = a.rootSpanName.localeCompare(b.rootSpanName)
          break
        case 'status':
          directionlessResult = Number(a.hasError) - Number(b.hasError)
          break
      }

      if (directionlessResult !== 0) {
        return sortOrder === 'asc' ? directionlessResult : -directionlessResult
      }

      const startTimeTieBreaker = b.startTime.localeCompare(a.startTime)
      if (startTimeTieBreaker !== 0) {
        return startTimeTieBreaker
      }

      return a.traceId.localeCompare(b.traceId)
    })

    return sorted
  })

  const selectedTraceIdSet = $derived(new Set(selectedTraceIds))
  const selectedFilteredCount = $derived(
    filteredTraces.filter((trace) => selectedTraceIdSet.has(trace.traceId))
      .length,
  )
  const allFilteredSelected = $derived(
    filteredTraces.length > 0 &&
      selectedFilteredCount === filteredTraces.length,
  )

  // Sync internal state to bindable props for parent header buttons
  $effect(() => {
    if (filteredCount !== filteredTraces.length) {
      filteredCount = filteredTraces.length
    }
  })
  $effect(() => {
    if (selectedCount !== selectedTraceIds.length) {
      selectedCount = selectedTraceIds.length
    }
  })
  $effect(() => {
    if (isExportingBound !== isExporting) {
      isExportingBound = isExporting
    }
  })

  $effect(() => {
    const visibleIds = new Set(filteredTraces.map((trace) => trace.traceId))
    const next = selectedTraceIds.filter((id) => visibleIds.has(id))
    const changed =
      next.length !== selectedTraceIds.length ||
      next.some((id, index) => id !== selectedTraceIds[index])
    if (changed) {
      selectedTraceIds = next
    }
  })

  function handleClearFilters() {
    searchQuery = ''
    selectedService = 'all'
    showErrorsOnly = false
    minDuration = null
    maxDuration = null
    selectedTraceIds = []
  }

  function getAriaSort(column: TraceSortBy) {
    if (sortBy !== column) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  function getSortIndicator(column: TraceSortBy) {
    if (sortBy !== column) return ''
    return sortOrder === 'asc' ? '↑' : '↓'
  }

  function handleSort(column: TraceSortBy) {
    if (sortBy === column) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      return
    }
    sortBy = column
    sortOrder = column === 'time' ? 'desc' : 'asc'
  }

  function handleRowClick(traceId: string) {
    window.location.href = `/traces/${encodeURIComponent(traceId)}`
  }

  $effect(() => {
    if (typeof window === 'undefined') return
    const nextUrl = new URL(window.location.href)
    applyFilterParams(nextUrl)
    if (nextUrl.search === window.location.search) return
    replaceState(nextUrl, {})
  })

  async function handleClearAll() {
    if (confirm('Clear all traces? This cannot be undone.')) {
      await traceStore.clearAllTraces()
      selectedTraceIds = []
    }
  }

  async function handleDeleteSelected() {
    if (selectedTraceIds.length === 0) return

    const targetCount = selectedTraceIds.length
    const confirmed = confirm(
      `Delete ${targetCount} selected trace${targetCount === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) return

    const deletedCount = await traceStore.deleteSelectedTraces(selectedTraceIds)
    if (deletedCount > 0) {
      selectedTraceIds = []
    }
  }

  function pad2(value: number): string {
    return String(value).padStart(2, '0')
  }

  function localFileTimestamp(date: Date): string {
    const year = date.getFullYear()
    const month = pad2(date.getMonth() + 1)
    const day = pad2(date.getDate())
    const hours = pad2(date.getHours())
    const minutes = pad2(date.getMinutes())
    const seconds = pad2(date.getSeconds())
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
  }

  async function exportTracesByIds(
    traceIds: string[],
    fallbackPrefix: 'filtered' | 'selected',
  ) {
    if (traceIds.length === 0) return

    isExporting = true
    exportError = null

    try {
      const response = await fetch('/api/traces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traceIds }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not export filtered traces')
      }

      const fileName =
        response.headers
          .get('content-disposition')
          ?.match(/filename="?([^";]+)"?/)?.[1] ||
        `traces-${fallbackPrefix}-${localFileTimestamp(new Date())}.json`

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      exportError =
        err instanceof Error ? err.message : 'Could not export filtered traces'
    } finally {
      isExporting = false
    }
  }

  async function handleExportFiltered() {
    await exportTracesByIds(
      filteredTraces.map((trace) => trace.traceId),
      'filtered',
    )
  }

  async function handleExportSelected() {
    await exportTracesByIds(selectedTraceIds, 'selected')
  }

  function toggleTraceSelection(traceId: string) {
    if (selectedTraceIdSet.has(traceId)) {
      selectedTraceIds = selectedTraceIds.filter((id) => id !== traceId)
      return
    }
    selectedTraceIds = [...selectedTraceIds, traceId]
  }

  function toggleSelectAllFiltered() {
    selectedTraceIds = filteredTraces
      .filter((trace) => !selectedTraceIdSet.has(trace.traceId))
      .map((trace) => trace.traceId)
  }

  function handleImportCompleted(result: {
    importedTraceCount: number
    importedSpanCount: number
  }) {
    importSuccessMessage = `Imported ${result.importedTraceCount} trace${result.importedTraceCount === 1 ? '' : 's'} and ${result.importedSpanCount} span${result.importedSpanCount === 1 ? '' : 's'}.`
  }

  function handleDismissImportSuccess() {
    importSuccessMessage = null
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === '/' && !isInputFocused()) {
      e.preventDefault()
      searchInputEl?.focus()
      return
    }
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
    if (e.key === 'Escape' && isInputFocused()) {
      searchQuery = ''
      searchInputEl?.blur()
    }
  }

  // Exposed for parent to call via bind:this
  export function setSelectedService(name: string) {
    selectedService = name
  }
  export function openImportModal() {
    exportError = null
    importSuccessMessage = null
    showImportModal = true
  }
  export function triggerExportFiltered() {
    void handleExportFiltered()
  }
  export function triggerExportSelected() {
    void handleExportSelected()
  }
  export function triggerClearAll() {
    void handleClearAll()
  }
  export function triggerDeleteSelected() {
    void handleDeleteSelected()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="traces-tab">
  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if exportError}
    <div class="error">{exportError}</div>
  {/if}

  {#if importSuccessMessage}
    <div class="success" role="status" aria-live="polite">
      <span>{importSuccessMessage}</span>
      <button
        class="success-dismiss"
        onclick={handleDismissImportSuccess}
        aria-label="Dismiss import success message"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  {/if}

  {#if !tracesLoaded}
    <div class="loading">
      <p>Loading traces…</p>
    </div>
  {:else if traces.length === 0}
    <div class="empty">
      <p>No traces received yet.</p>
      <p class="hint">
        Send OTLP traces to <code>{otlpEndpoint}</code>.
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
              <th class="select-col">
                <input
                  type="checkbox"
                  class="row-checkbox"
                  checked={allFilteredSelected}
                  onchange={toggleSelectAllFiltered}
                  aria-label="Invert filtered trace selection"
                  title="Invert filtered trace selection"
                />
              </th>
              <th aria-sort={getAriaSort('rootService')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('rootService')}
                  aria-label="Sort by root service"
                >
                  Root Service
                  <span class="sort-indicator"
                    >{getSortIndicator('rootService')}</span
                  >
                </button>
              </th>
              <th aria-sort={getAriaSort('rootName')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('rootName')}
                  aria-label="Sort by root name"
                >
                  Root Name
                  <span class="sort-indicator"
                    >{getSortIndicator('rootName')}</span
                  >
                </button>
              </th>
              <th aria-sort={getAriaSort('duration')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('duration')}
                  aria-label="Sort by duration"
                >
                  Duration
                  <span class="sort-indicator"
                    >{getSortIndicator('duration')}</span
                  >
                </button>
              </th>
              <th aria-sort={getAriaSort('spans')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('spans')}
                  aria-label="Sort by spans"
                >
                  Spans
                  <span class="sort-indicator">{getSortIndicator('spans')}</span
                  >
                </button>
              </th>
              <th aria-sort={getAriaSort('logs')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('logs')}
                  aria-label="Sort by logs"
                >
                  Logs
                  <span class="sort-indicator">{getSortIndicator('logs')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('time')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('time')}
                  aria-label="Sort by time"
                >
                  Time
                  <span class="sort-indicator">{getSortIndicator('time')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('status')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('status')}
                  aria-label="Sort by status"
                >
                  Status
                  <span class="sort-indicator"
                    >{getSortIndicator('status')}</span
                  >
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each filteredTraces as trace (trace.traceId)}
              {@const formattedDuration = formatDurationFromMs(
                trace.durationMs,
              )}
              <tr
                onclick={() => handleRowClick(trace.traceId)}
                class:error={trace.hasError}
                class:selected={selectedTraceIdSet.has(trace.traceId)}
              >
                <td
                  class="select-col"
                  onclick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    class="row-checkbox"
                    checked={selectedTraceIdSet.has(trace.traceId)}
                    onchange={() => toggleTraceSelection(trace.traceId)}
                    aria-label={`Select trace ${trace.traceId}`}
                  />
                </td>
                <td><ServiceBadge serviceName={trace.serviceName} /></td>
                <td
                  class="operation"
                  title={trace.rootSpanTentative
                    ? `${trace.rootSpanName} (root span not yet received)`
                    : trace.rootSpanName}
                >
                  {#if trace.rootSpanTentative}
                    <span class="tentative-icon" aria-label="Root span pending"
                      >⏳</span
                    >
                  {/if}{trace.rootSpanName}</td
                >
                <td class="duration" title={formattedDuration.detailed}
                  >{formattedDuration.simple}</td
                >
                <td class="span-count">{trace.spanCount}</td>
                <td class="span-count">{trace.logCount ?? 0}</td>
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
    {/if}
  {/if}

  <div class="bottom-bar">
    <VersionInfo />
    <p class="retention-notice">
      Keeping last
      <span
        class="retention-limit"
        title="Set OTEL_GUI_MAX_TRACES=<number> (1–10 000) and restart to change this limit."
        >{maxTraces}</span
      >
      traces
      {#if persistence.enabled}
        <span class="persistence-mode" title={persistence.path || undefined}>
          persisted via PGlite</span
        >
      {:else}
        <span
          class="persistence-mode persistence-mode--memory"
          title="Optional persistence can be activated — see documentation"
        >
          in memory only
          <a
            href="https://github.com/metafab/otel-gui#%EF%B8%8F-configuration"
            target="_blank"
            rel="noopener noreferrer"
            class="persistence-docs-link"
            title="View persistence configuration docs"
            aria-label="Persistence documentation">?</a
          >
        </span>
      {/if}
    </p>
  </div>
</div>

{#if showImportModal}
  <TraceImportModal
    onclose={() => (showImportModal = false)}
    onimported={handleImportCompleted}
  />
{/if}

<style>
  .traces-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .error {
    padding: 1rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 4px;
    color: var(--error-text);
    margin-bottom: 1rem;
  }

  .success {
    padding: 0.8rem 1rem;
    background: var(--ok-bg);
    border: 1px solid var(--ok-border);
    border-radius: 4px;
    color: var(--ok-text);
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .success-dismiss {
    border: 1px solid var(--ok-border);
    background: transparent;
    color: var(--ok-text);
    border-radius: 4px;
    width: 24px;
    height: 24px;
    line-height: 1;
    cursor: pointer;
    font-size: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .success-dismiss:hover {
    background: color-mix(in srgb, var(--ok-border) 20%, transparent);
  }

  .clear-filters-btn {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.875rem;
    transition: all 0.15s ease;
  }

  .clear-filters-btn:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
  }

  .table-wrapper {
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 1px 3px var(--shadow);
    background: var(--bg-surface);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    margin-bottom: 0.25rem;
  }

  .bottom-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin: auto 0 0.75rem;
  }

  .retention-notice {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: 0;
  }

  .retention-limit {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: help;
  }

  .persistence-mode {
    color: var(--text-secondary);
  }

  .persistence-docs-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 4px;
    border-radius: 50%;
    border: 1px solid var(--text-secondary);
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: bold;
    line-height: 1;
    text-decoration: none;
    vertical-align: middle;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .persistence-docs-link:hover {
    opacity: 1;
    color: var(--accent, #3b82f6);
    border-color: var(--accent, #3b82f6);
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: var(--bg-surface);
    table-layout: fixed;
    min-width: 940px;
  }

  /* Fixed-width columns; Root Name gets the remaining space with a min-width */
  th:nth-child(1) {
    width: 22px;
  }
  th:nth-child(2) {
    width: 150px;
  }
  th:nth-child(3) {
    min-width: 200px;
  }
  th:nth-child(4) {
    width: 165px;
  }
  th:nth-child(5) {
    width: 90px;
  }
  th:nth-child(6) {
    width: 90px;
  }
  th:nth-child(7) {
    width: 175px;
  }
  th:nth-child(8) {
    width: 95px;
  }

  .select-col {
    text-align: center;
    padding-left: 0.25rem;
    padding-right: 0.25rem;
  }

  .row-checkbox {
    width: 14px;
    height: 14px;
    cursor: pointer;
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

  tbody tr.selected {
    background: var(--selected-bg);
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

  .tentative-icon {
    font-style: normal;
    margin-right: 0.25rem;
    opacity: 0.6;
    font-size: 0.8em;
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
