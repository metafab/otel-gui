<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import MetricsFilter from '$lib/components/MetricsFilter.svelte'
  import VersionInfo from '$lib/components/VersionInfo.svelte'
  import { metricStore } from '$lib/stores/metrics.svelte'
  import { onSSEEvents } from '$lib/stores/sseClient'
  import type { MetricListItem } from '$lib/types'

  // Bindable props so parent can read reactive state for header action buttons.
  let {
    totalCount = $bindable(0),
    selectedCount = $bindable(0),
    isDeletingBound = $bindable(false),
  } = $props()

  let metrics = $state.raw<MetricListItem[]>([])
  // Only true until the first snapshot (or fallback load) arrives. Background
  // delta updates never toggle this, so the table is never torn down/remounted.
  let isLoading = $state(true)
  let loadError = $state<string | null>(null)

  type MetricSortBy =
    | 'name'
    | 'type'
    | 'unit'
    | 'service'
    | 'series'
    | 'updated'
  type MetricSortOrder = 'asc' | 'desc'
  const DEFAULT_SORT_BY: MetricSortBy = 'updated'
  const DEFAULT_SORT_ORDER: MetricSortOrder = 'desc'

  function parseSortBy(rawValue: string | null): MetricSortBy {
    switch (rawValue) {
      case 'name':
      case 'type':
      case 'unit':
      case 'service':
      case 'series':
      case 'updated':
        return rawValue
      default:
        return DEFAULT_SORT_BY
    }
  }

  function parseSortOrder(rawValue: string | null): MetricSortOrder {
    return rawValue === 'asc' || rawValue === 'desc'
      ? rawValue
      : DEFAULT_SORT_ORDER
  }

  type MetricTypeFilter =
    | 'all'
    | 'gauge'
    | 'sum'
    | 'histogram'
    | 'exp_histogram'
    | 'summary'

  function parseTypeFilter(rawValue: string | null): MetricTypeFilter {
    switch (rawValue) {
      case 'gauge':
      case 'sum':
      case 'histogram':
      case 'exp_histogram':
      case 'summary':
        return rawValue
      default:
        return 'all'
    }
  }

  function readParamsFromLocation() {
    if (typeof window === 'undefined') {
      return {
        searchQuery: '',
        typeFilter: 'all',
        selectedService: 'all',
        sortBy: DEFAULT_SORT_BY,
        sortOrder: DEFAULT_SORT_ORDER,
      } as const
    }

    const url = new URL(window.location.href)
    return {
      searchQuery: url.searchParams.get('search') ?? '',
      typeFilter: parseTypeFilter(url.searchParams.get('type')),
      selectedService: url.searchParams.get('service') ?? 'all',
      sortBy: parseSortBy(url.searchParams.get('sort')),
      sortOrder: parseSortOrder(url.searchParams.get('order')),
    } as const
  }

  function applyParams(url: URL) {
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery)
    } else {
      url.searchParams.delete('search')
    }

    if (typeFilter !== 'all') {
      url.searchParams.set('type', typeFilter)
    } else {
      url.searchParams.delete('type')
    }

    if (selectedService !== 'all') {
      url.searchParams.set('service', selectedService)
    } else {
      url.searchParams.delete('service')
    }

    if (sortBy === DEFAULT_SORT_BY && sortOrder === DEFAULT_SORT_ORDER) {
      url.searchParams.delete('sort')
      url.searchParams.delete('order')
      return
    }

    url.searchParams.set('sort', sortBy)
    url.searchParams.set('order', sortOrder)
  }

  const initialParams = readParamsFromLocation()

  let searchQuery = $state(initialParams.searchQuery)
  let typeFilter = $state<MetricTypeFilter>(initialParams.typeFilter)
  let selectedService = $state<string>(initialParams.selectedService)
  let sortBy = $state<MetricSortBy>(initialParams.sortBy)
  let sortOrder = $state<MetricSortOrder>(initialParams.sortOrder)
  let selectedMetricIds = $state<string[]>([])
  let isDeleting = $state(false)

  const otlpMetricsEndpoint = $derived.by(() => {
    if (typeof window !== 'undefined') {
      const { protocol, hostname, port } = window.location
      return `${protocol}//${hostname}${port ? ':' + port : ''}/v1/metrics`
    }
    return 'http://localhost:4318/v1/metrics'
  })
  const maxMetrics = $derived(metricStore.maxMetrics)

  $effect(() => {
    if (totalCount !== metrics.length) {
      totalCount = metrics.length
    }
  })
  $effect(() => {
    if (selectedCount !== selectedMetricIds.length) {
      selectedCount = selectedMetricIds.length
    }
  })
  $effect(() => {
    if (isDeletingBound !== isDeleting) {
      isDeletingBound = isDeleting
    }
  })

  $effect(() => {
    if (typeof window === 'undefined') return
    const nextUrl = new URL(window.location.href)
    applyParams(nextUrl)
    if (nextUrl.search === window.location.search) return
    try {
      replaceState(nextUrl, {})
    } catch {
      // Component tests can run before SvelteKit router bootstraps.
      window.history.replaceState(window.history.state, '', nextUrl)
    }
  })

  function formatUpdated(ms: number): string {
    if (!ms) return '-'
    try {
      return new Date(ms).toLocaleString()
    } catch {
      return '-'
    }
  }

  function formatUpdatedTitle(ms: number): string {
    if (!ms) return '-'
    try {
      return new Date(ms).toISOString()
    } catch {
      return '-'
    }
  }

  // Build a tiny inline SVG polyline for the row sparkline. No uPlot needed —
  // keeps list rows cheap.
  const SPARK_W = 80
  const SPARK_H = 20
  function sparklinePoints(values: number[]): string {
    if (!values || values.length === 0) return ''
    if (values.length === 1) {
      const y = SPARK_H / 2
      return `0,${y} ${SPARK_W},${y}`
    }
    let min = values[0]
    let max = values[0]
    for (const v of values) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const range = max - min || 1
    const stepX = SPARK_W / (values.length - 1)
    return values
      .map((v, i) => {
        const x = i * stepX
        // Invert y (SVG y grows downward); pad 2px top/bottom.
        const norm = (v - min) / range
        const y = SPARK_H - 2 - norm * (SPARK_H - 4)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const services = $derived(
    Array.from(
      new Set(metrics.map((m) => m.serviceName).filter(Boolean)),
    ).sort(),
  )

  // If the selected service disappears (e.g. after a clear/delete or eviction),
  // fall back to "all" so the list isn't stuck showing nothing.
  $effect(() => {
    if (selectedService === 'all' || services.length === 0) return
    if (!services.includes(selectedService)) {
      selectedService = 'all'
    }
  })

  const filteredMetrics = $derived.by(() => {
    if (!Array.isArray(metrics)) return []
    const query = searchQuery.trim().toLowerCase()

    return metrics.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) {
        return false
      }
      if (selectedService !== 'all' && m.serviceName !== selectedService) {
        return false
      }
      if (query) {
        const haystack =
          `${m.name} ${m.serviceName} ${m.unit} ${m.id}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  })

  const sortedMetrics = $derived.by(() => {
    const toSort = [...filteredMetrics]

    toSort.sort((a, b) => {
      let directionlessResult = 0

      switch (sortBy) {
        case 'name':
          directionlessResult = (a.name || '').localeCompare(b.name || '')
          break
        case 'type':
          directionlessResult = (a.type || '').localeCompare(b.type || '')
          break
        case 'unit':
          directionlessResult = (a.unit || '').localeCompare(b.unit || '')
          break
        case 'service':
          directionlessResult = (a.serviceName || '').localeCompare(
            b.serviceName || '',
          )
          break
        case 'series':
          directionlessResult = a.seriesCount - b.seriesCount
          break
        case 'updated':
          directionlessResult = a.lastUpdated - b.lastUpdated
          break
      }

      if (directionlessResult !== 0) {
        return sortOrder === 'asc' ? directionlessResult : -directionlessResult
      }

      return b.lastUpdated - a.lastUpdated
    })

    return toSort
  })

  const selectedMetricIdSet = $derived(new Set(selectedMetricIds))
  const selectedFilteredCount = $derived(
    sortedMetrics.filter((m) => selectedMetricIdSet.has(m.id)).length,
  )
  const allFilteredSelected = $derived(
    sortedMetrics.length > 0 && selectedFilteredCount === sortedMetrics.length,
  )

  $effect(() => {
    const visibleIds = new Set(sortedMetrics.map((m) => m.id))
    const next = selectedMetricIds.filter((id) => visibleIds.has(id))
    const changed =
      next.length !== selectedMetricIds.length ||
      next.some((id, index) => id !== selectedMetricIds[index])

    if (changed) {
      selectedMetricIds = next
    }
  })

  // Fallback for environments without EventSource — the live view is otherwise
  // driven entirely by the SSE snapshot/append stream (see the $effect below).
  // `shouldApply` lets the caller discard a slow REST response if a live SSE
  // snapshot has already updated the list in the meantime (avoids a stale seed
  // clobbering fresher data during a concurrent clear/delete).
  async function loadMetrics(shouldApply: () => boolean = () => true) {
    isLoading = true
    loadError = null
    try {
      const response = await fetch('/api/metrics?limit=5000')
      if (!response.ok) {
        throw new Error(`Failed to load metrics: ${response.statusText}`)
      }
      const data = await response.json()
      if (shouldApply()) metrics = data
    } catch (error) {
      if (shouldApply()) {
        loadError =
          error instanceof Error
            ? error.message
            : 'Unknown error loading metrics'
        metrics = []
      }
    } finally {
      isLoading = false
    }
  }

  // Merge newly-streamed metrics into the existing list (upsert by id) without
  // refetching everything, then cap to maxMetrics to mirror server eviction.
  function applyAppend(incoming: MetricListItem[]) {
    if (incoming.length === 0) return

    const byId = new Map<string, MetricListItem>()
    for (const m of metrics) byId.set(m.id, m)
    for (const m of incoming) byId.set(m.id, m)

    let merged = Array.from(byId.values())
    if (merged.length > maxMetrics) {
      merged.sort((a, b) => b.lastUpdated - a.lastUpdated)
      merged = merged.slice(0, maxMetrics)
    }

    metrics = merged
  }

  async function clearAllMetrics() {
    const confirmed = confirm('Clear all metrics? This cannot be undone.')
    if (!confirmed) {
      return
    }

    isDeleting = true
    loadError = null
    try {
      const response = await fetch('/api/metrics', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`Failed to clear metrics: ${response.statusText}`)
      }

      metrics = []
      selectedMetricIds = []
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : 'Unknown error clearing metrics'
    } finally {
      isDeleting = false
    }
  }

  async function deleteSelectedMetrics() {
    if (selectedMetricIds.length === 0) {
      return
    }

    const targetCount = selectedMetricIds.length
    const confirmed = confirm(
      `Delete ${targetCount} selected metric${targetCount === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    isDeleting = true
    loadError = null
    try {
      const response = await fetch('/api/metrics', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedMetricIds }),
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
        const selected = new Set(selectedMetricIds)
        metrics = metrics.filter((m) => !selected.has(m.id))
        selectedMetricIds = []
      }
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : 'Unknown error deleting selected metrics'
    } finally {
      isDeleting = false
    }
  }

  function toggleSelectAllFiltered() {
    selectedMetricIds = sortedMetrics
      .filter((m) => !selectedMetricIdSet.has(m.id))
      .map((m) => m.id)
  }

  function getAriaSort(column: MetricSortBy) {
    if (sortBy !== column) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  function getSortIndicator(column: MetricSortBy) {
    if (sortBy !== column) return ''
    return sortOrder === 'asc' ? '↑' : '↓'
  }

  function handleSort(column: MetricSortBy) {
    if (sortBy === column) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      return
    }

    sortBy = column
    sortOrder = column === 'updated' || column === 'series' ? 'desc' : 'asc'
  }

  function handleRowClick(metricId: string) {
    // Client-side navigation — see Traces.svelte: a full-page load tears down and
    // re-establishes every SSE stream on each open, stalling against the browser's
    // 6-connection-per-origin limit.
    void goto(`/metrics/${encodeURIComponent(metricId)}`)
  }

  // Keyboard activation for the row (Enter/Space), only when the row itself —
  // not a child control like the select checkbox — is focused.
  function handleRowKeydown(event: KeyboardEvent, metricId: string) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(metricId)
    }
  }

  function toggleMetricSelection(metricId: string) {
    if (selectedMetricIdSet.has(metricId)) {
      selectedMetricIds = selectedMetricIds.filter((id) => id !== metricId)
      return
    }

    selectedMetricIds = [...selectedMetricIds, metricId]
  }

  function handleClearFilters() {
    searchQuery = ''
    typeFilter = 'all'
    selectedService = 'all'
  }

  $effect(() => {
    // Seed the current list once on mount. The shared SSE connection only
    // replays its snapshot at connect time (page load) — this component mounts
    // later, when the Metrics tab is opened, so it would otherwise miss the
    // initial snapshot and stay empty until the next ingest. REST gives the
    // initial paint; live deltas (append) and clear/delete re-syncs follow.
    //
    // If an SSE snapshot lands while that REST seed is still in flight (e.g. a
    // concurrent clear), the seed must not overwrite it — track that here.
    let sseSnapshotApplied = false
    void loadMetrics(() => !sseSnapshotApplied)

    // No EventSource (SSR/legacy) — the REST load above is all we get.
    if (typeof EventSource === 'undefined') return

    // Metric list events arrive over the shared app-wide SSE connection.
    return onSSEEvents({
      // Full list: re-sent after any clear/delete (re-sync).
      'metrics-snapshot': (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          metrics = Array.isArray(data.metrics) ? data.metrics : []
          loadError = null
          sseSnapshotApplied = true
        } catch {
          // Ignore malformed payloads; the next snapshot will re-sync.
        } finally {
          isLoading = false
        }
      },
      // Incremental: only metrics touched since the last cursor. Merged in place
      // so the table updates without a full re-render (no flash).
      'metrics-append': (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          if (Array.isArray(data.metrics)) applyAppend(data.metrics)
        } catch {
          // Ignore malformed payloads.
        }
      },
    })
  })

  export function triggerClearAll() {
    void clearAllMetrics()
  }
  export function triggerDeleteSelected() {
    void deleteSelectedMetrics()
  }
</script>

<div class="metrics-panel">
  {#if loadError}
    <div class="error">{loadError}</div>
  {/if}

  {#if isLoading}
    <div class="empty">
      <p>Loading metrics...</p>
    </div>
  {:else if metrics.length === 0}
    <div class="empty">
      <p>No metrics received yet.</p>
      <p class="hint">
        Send OTLP metrics to <code>{otlpMetricsEndpoint}</code>.
      </p>
    </div>
  {:else}
    <MetricsFilter
      {services}
      bind:searchQuery
      bind:typeFilter
      bind:selectedService
      filteredCount={sortedMetrics.length}
      totalCount={metrics.length}
    />

    {#if sortedMetrics.length === 0}
      <div class="empty">
        <p>No metrics match the current filters.</p>
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
                  aria-label="Invert filtered metric selection"
                  title="Invert filtered metric selection"
                />
              </th>
              <th aria-sort={getAriaSort('name')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('name')}
                  aria-label="Sort by name"
                >
                  Name
                  <span class="sort-indicator">{getSortIndicator('name')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('type')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('type')}
                  aria-label="Sort by type"
                >
                  Type
                  <span class="sort-indicator">{getSortIndicator('type')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('unit')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('unit')}
                  aria-label="Sort by unit"
                >
                  Unit
                  <span class="sort-indicator">{getSortIndicator('unit')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('service')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('service')}
                  aria-label="Sort by service"
                >
                  Service
                  <span class="sort-indicator"
                    >{getSortIndicator('service')}</span
                  >
                </button>
              </th>
              <th aria-sort={getAriaSort('series')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('series')}
                  aria-label="Sort by series count"
                >
                  #Series
                  <span class="sort-indicator"
                    >{getSortIndicator('series')}</span
                  >
                </button>
              </th>
              <th>Sparkline</th>
              <th aria-sort={getAriaSort('updated')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('updated')}
                  aria-label="Sort by last updated"
                >
                  Last Updated
                  <span class="sort-indicator"
                    >{getSortIndicator('updated')}</span
                  >
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each sortedMetrics as metric (metric.id)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <tr
                onclick={() => handleRowClick(metric.id)}
                onkeydown={(e) => handleRowKeydown(e, metric.id)}
                tabindex="0"
                data-testid="metric-row"
                data-metric-id={metric.id}
                class:selected={selectedMetricIdSet.has(metric.id)}
              >
                <td
                  class="select-col"
                  onclick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    class="row-checkbox"
                    checked={selectedMetricIdSet.has(metric.id)}
                    onchange={() => toggleMetricSelection(metric.id)}
                    aria-label={`Select metric ${metric.name}`}
                  />
                </td>
                <td class="metric-name" title={metric.name}>
                  {metric.name}
                </td>
                <td>
                  <span class={`type-badge type-${metric.type}`}>
                    {metric.type}
                  </span>
                </td>
                <td class="unit">{metric.unit || '-'}</td>
                <td>
                  <ServiceBadge serviceName={metric.serviceName || 'unknown'} />
                </td>
                <td class="series-count">{metric.seriesCount}</td>
                <td class="spark-cell">
                  {#if metric.sparkline && metric.sparkline.length > 0}
                    <svg
                      class="sparkline"
                      width={SPARK_W}
                      height={SPARK_H}
                      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points={sparklinePoints(metric.sparkline)}
                        fill="none"
                        stroke="var(--accent)"
                        stroke-width="1.5"
                      />
                    </svg>
                  {:else}
                    <span class="muted">-</span>
                  {/if}
                </td>
                <td
                  class="timestamp"
                  title={formatUpdatedTitle(metric.lastUpdated)}
                  >{formatUpdated(metric.lastUpdated)}</td
                >
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
        title="Set OTEL_GUI_MAX_METRICS=<number> (1–10 000) and restart to change this limit."
        >{maxMetrics}</span
      >
      metric series
      <span
        class="persistence-mode persistence-mode--memory"
        title="Metrics are memory-only in Phase 1"
      >
        in memory only
      </span>
    </p>
  </div>
</div>

<style>
  .metrics-panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    flex: 1;
  }

  .table-wrapper {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
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

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  th,
  td {
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  tr.selected {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
  }

  .select-col {
    width: 2rem;
    text-align: center;
  }

  .row-checkbox {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .metric-name {
    font-weight: 500;
    color: var(--text-primary);
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unit {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .series-count {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .timestamp {
    white-space: nowrap;
  }

  .spark-cell {
    width: 90px;
  }

  .sparkline {
    display: block;
  }

  .muted {
    color: var(--text-secondary);
  }

  tbody tr {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: var(--bg-surface-hover);
  }

  .type-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.4rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    border: 1px solid transparent;
    text-transform: uppercase;
  }

  .type-gauge {
    color: #0f4c81;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .type-sum {
    color: #92400e;
    background: #fff7ed;
    border-color: #fed7aa;
  }

  .type-histogram {
    color: #4c1d95;
    background: #f5f3ff;
    border-color: #ddd6fe;
  }

  .type-exp_histogram {
    color: #155e75;
    background: #ecfeff;
    border-color: #a5f3fc;
  }

  .type-summary {
    color: #166534;
    background: #f0fdf4;
    border-color: #bbf7d0;
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

  @media (max-width: 1024px) {
    .metric-name {
      max-width: 220px;
    }
  }

  @media (max-width: 768px) {
    table {
      min-width: 800px;
    }
  }
</style>
