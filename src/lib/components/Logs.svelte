<script lang="ts">
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import LogsFilter from '$lib/components/LogsFilter.svelte'
  import type { LogListItem } from '$lib/types'
  import { formatTimestampLocal } from '$lib/utils/time'

  // Bindable props so parent can read reactive state for header action buttons
  let {
    totalCount = $bindable(0),
    selectedCount = $bindable(0),
    isDeletingBound = $bindable(false),
  } = $props()

  let logs = $state.raw<LogListItem[]>([])
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let searchQuery = $state('')
  let severityFilter = $state<
    'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error'
  >('all')
  type LogSortBy = 'time' | 'service' | 'severity' | 'body' | 'trace' | 'span'
  type LogSortOrder = 'asc' | 'desc'
  const DEFAULT_SORT_BY: LogSortBy = 'time'
  const DEFAULT_SORT_ORDER: LogSortOrder = 'desc'

  function parseSortBy(rawValue: string | null): LogSortBy {
    switch (rawValue) {
      case 'time':
      case 'service':
      case 'severity':
      case 'body':
      case 'trace':
      case 'span':
        return rawValue
      default:
        return DEFAULT_SORT_BY
    }
  }

  function parseSortOrder(rawValue: string | null): LogSortOrder {
    return rawValue === 'asc' || rawValue === 'desc'
      ? rawValue
      : DEFAULT_SORT_ORDER
  }

  function readSortParamsFromLocation() {
    if (typeof window === 'undefined') {
      return {
        sortBy: DEFAULT_SORT_BY,
        sortOrder: DEFAULT_SORT_ORDER,
      } as const
    }

    const url = new URL(window.location.href)
    return {
      sortBy: parseSortBy(url.searchParams.get('sort')),
      sortOrder: parseSortOrder(url.searchParams.get('order')),
    } as const
  }

  function applySortParams(url: URL) {
    if (sortBy === DEFAULT_SORT_BY && sortOrder === DEFAULT_SORT_ORDER) {
      url.searchParams.delete('sort')
      url.searchParams.delete('order')
      return
    }

    url.searchParams.set('sort', sortBy)
    url.searchParams.set('order', sortOrder)
  }

  const initialSort = readSortParamsFromLocation()

  let sortBy = $state<LogSortBy>(initialSort.sortBy)
  let sortOrder = $state<LogSortOrder>(initialSort.sortOrder)
  let selectedLogIds = $state<string[]>([])
  let isDeleting = $state(false)

  const otlpLogsEndpoint = $derived.by(() => {
    if (typeof window !== 'undefined') {
      const { protocol, hostname, port } = window.location
      return `${protocol}//${hostname}${port ? ':' + port : ''}/v1/logs`
    }
    return 'http://localhost:4318/v1/logs'
  })

  $effect(() => {
    if (totalCount !== logs.length) {
      totalCount = logs.length
    }
  })
  $effect(() => {
    if (selectedCount !== selectedLogIds.length) {
      selectedCount = selectedLogIds.length
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
    applySortParams(nextUrl)
    if (nextUrl.search === window.location.search) return
    window.history.replaceState(window.history.state, '', nextUrl)
  })

  function severityBucket(
    log: LogListItem,
  ): 'trace' | 'debug' | 'info' | 'warn' | 'error' {
    const n = Number(log.severityNumber) || 0
    if (n >= 17) return 'error'
    if (n >= 13) return 'warn'
    if (n >= 9) return 'info'
    if (n >= 5) return 'debug'
    return 'trace'
  }

  function normalizeBody(value: unknown): string {
    if (value == null) return ''
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value)
    }

    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

  function formatLogTime(log: LogListItem): string {
    const ts = log.timeUnixNano || log.observedTimeUnixNano
    if (!ts) return '-'

    try {
      return formatTimestampLocal(ts)
    } catch {
      return '-'
    }
  }

  function formatLogTimeTitle(log: LogListItem): string {
    const ts = log.timeUnixNano || log.observedTimeUnixNano
    if (!ts) return '-'

    try {
      const ms = Number(BigInt(ts) / 1_000_000n)
      return new Date(ms).toISOString()
    } catch {
      return '-'
    }
  }

  const filteredLogs = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()

    return logs.filter((log) => {
      if (severityFilter !== 'all' && severityBucket(log) !== severityFilter) {
        return false
      }

      if (!query) {
        return true
      }

      const service = (log.serviceName || '').toLowerCase()
      const severity = (log.severityText || '').toLowerCase()
      const body = normalizeBody(log.body).toLowerCase()
      const traceId = (log.traceId || '').toLowerCase()
      const spanId = (log.spanId || '').toLowerCase()
      const logId = (log.id || '').toLowerCase()

      return (
        service.includes(query) ||
        severity.includes(query) ||
        body.includes(query) ||
        traceId.includes(query) ||
        spanId.includes(query) ||
        logId.includes(query)
      )
    })
  })

  const sortedLogs = $derived.by(() => {
    const logsToSort = [...filteredLogs]

    logsToSort.sort((a, b) => {
      let directionlessResult = 0

      switch (sortBy) {
        case 'time': {
          const aTs = BigInt(a.timeUnixNano || a.observedTimeUnixNano || '0')
          const bTs = BigInt(b.timeUnixNano || b.observedTimeUnixNano || '0')
          directionlessResult = aTs < bTs ? -1 : aTs > bTs ? 1 : 0
          break
        }
        case 'service':
          directionlessResult = (a.serviceName || '').localeCompare(
            b.serviceName || '',
          )
          break
        case 'severity':
          directionlessResult =
            (Number(a.severityNumber) || 0) - (Number(b.severityNumber) || 0)
          break
        case 'body':
          directionlessResult = normalizeBody(a.body).localeCompare(
            normalizeBody(b.body),
          )
          break
        case 'trace':
          directionlessResult = (a.traceId || '').localeCompare(b.traceId || '')
          break
        case 'span':
          directionlessResult = (a.spanId || '').localeCompare(b.spanId || '')
          break
      }

      if (directionlessResult !== 0) {
        return sortOrder === 'asc' ? directionlessResult : -directionlessResult
      }

      const aTs = BigInt(a.timeUnixNano || a.observedTimeUnixNano || '0')
      const bTs = BigInt(b.timeUnixNano || b.observedTimeUnixNano || '0')
      return bTs < aTs ? -1 : bTs > aTs ? 1 : 0
    })

    return logsToSort
  })

  const selectedLogIdSet = $derived(new Set(selectedLogIds))
  const selectedFilteredCount = $derived(
    sortedLogs.filter((log) => selectedLogIdSet.has(log.id)).length,
  )
  const allFilteredSelected = $derived(
    sortedLogs.length > 0 && selectedFilteredCount === sortedLogs.length,
  )

  $effect(() => {
    const visibleIds = new Set(sortedLogs.map((log) => log.id))
    const next = selectedLogIds.filter((id) => visibleIds.has(id))
    const changed =
      next.length !== selectedLogIds.length ||
      next.some((id, index) => id !== selectedLogIds[index])

    if (changed) {
      selectedLogIds = next
    }
  })

  async function loadLogs() {
    isLoading = true
    loadError = null
    try {
      const response = await fetch('/api/logs?limit=5000')
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`)
      }
      logs = await response.json()
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unknown error loading logs'
      logs = []
    } finally {
      isLoading = false
    }
  }

  async function clearAllLogs() {
    const confirmed = confirm('Clear all logs? This cannot be undone.')
    if (!confirmed) {
      return
    }

    isDeleting = true
    loadError = null
    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`Failed to clear logs: ${response.statusText}`)
      }

      logs = []
      selectedLogIds = []
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unknown error clearing logs'
    } finally {
      isDeleting = false
    }
  }

  async function deleteSelectedLogs() {
    if (selectedLogIds.length === 0) {
      return
    }

    const targetCount = selectedLogIds.length
    const confirmed = confirm(
      `Delete ${targetCount} selected log${targetCount === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    isDeleting = true
    loadError = null
    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logIds: selectedLogIds }),
      })

      if (!response.ok) {
        throw new Error(
          `Failed to delete selected logs: ${response.statusText}`,
        )
      }

      const payload = await response.json()
      const deletedCount =
        typeof payload.deletedCount === 'number' ? payload.deletedCount : 0

      if (deletedCount > 0) {
        const selected = new Set(selectedLogIds)
        logs = logs.filter((log) => !selected.has(log.id))
        selectedLogIds = []
      }
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : 'Unknown error deleting selected logs'
    } finally {
      isDeleting = false
    }
  }

  function toggleSelectAllFiltered() {
    selectedLogIds = sortedLogs
      .filter((log) => !selectedLogIdSet.has(log.id))
      .map((log) => log.id)
  }

  function getAriaSort(column: LogSortBy) {
    if (sortBy !== column) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  function getSortIndicator(column: LogSortBy) {
    if (sortBy !== column) return ''
    return sortOrder === 'asc' ? '↑' : '↓'
  }

  function handleSort(column: LogSortBy) {
    if (sortBy === column) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      return
    }

    sortBy = column
    sortOrder = column === 'time' ? 'desc' : 'asc'
  }

  function toggleLogSelection(logId: string) {
    if (selectedLogIdSet.has(logId)) {
      selectedLogIds = selectedLogIds.filter((id) => id !== logId)
      return
    }

    selectedLogIds = [...selectedLogIds, logId]
  }

  function handleClearFilters() {
    searchQuery = ''
    severityFilter = 'all'
  }

  $effect(() => {
    void loadLogs()
  })

  $effect(() => {
    if (typeof EventSource === 'undefined') return

    const es = new EventSource('/api/logs/stream')
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    es.addEventListener('logs-count', () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void loadLogs()
      }, 75)
    })

    es.onerror = () => {
      // EventSource auto-reconnects.
    }

    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      es.close()
    }
  })

  export function triggerClearAll() {
    void clearAllLogs()
  }
  export function triggerDeleteSelected() {
    void deleteSelectedLogs()
  }
</script>

<div class="logs-panel">
  {#if loadError}
    <div class="error">{loadError}</div>
  {/if}

  {#if isLoading}
    <div class="empty">
      <p>Loading logs...</p>
    </div>
  {:else if logs.length === 0}
    <div class="empty">
      <p>No logs received yet.</p>
      <p class="hint">Send OTLP logs to <code>{otlpLogsEndpoint}</code>.</p>
    </div>
  {:else}
    <LogsFilter
      bind:searchQuery
      bind:severityFilter
      filteredCount={sortedLogs.length}
      totalCount={logs.length}
    />

    {#if sortedLogs.length === 0}
      <div class="empty">
        <p>No logs match the current filters.</p>
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
                  aria-label="Invert filtered log selection"
                  title="Invert filtered log selection"
                />
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
              <th aria-sort={getAriaSort('service')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('service')}
                  aria-label="Sort by service"
                >
                  Service
                  <span class="sort-indicator">{getSortIndicator('service')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('severity')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('severity')}
                  aria-label="Sort by severity"
                >
                  Severity
                  <span class="sort-indicator">{getSortIndicator('severity')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('body')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('body')}
                  aria-label="Sort by body"
                >
                  Body
                  <span class="sort-indicator">{getSortIndicator('body')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('trace')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('trace')}
                  aria-label="Sort by trace"
                >
                  Trace
                  <span class="sort-indicator">{getSortIndicator('trace')}</span>
                </button>
              </th>
              <th aria-sort={getAriaSort('span')}>
                <button
                  type="button"
                  class="sortable-header"
                  onclick={() => handleSort('span')}
                  aria-label="Sort by span"
                >
                  Span
                  <span class="sort-indicator">{getSortIndicator('span')}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each sortedLogs as log (log.id)}
              <tr class:selected={selectedLogIdSet.has(log.id)}>
                <td class="select-col">
                  <input
                    type="checkbox"
                    class="row-checkbox"
                    checked={selectedLogIdSet.has(log.id)}
                    onchange={() => toggleLogSelection(log.id)}
                    aria-label={`Select log ${log.id}`}
                  />
                </td>
                <td class="timestamp" title={formatLogTimeTitle(log)}>{formatLogTime(log)}</td>
                <td><ServiceBadge serviceName={log.serviceName || 'unknown'} /></td>
                <td>
                  <span
                    class={`severity-badge severity-${severityBucket(log)}`}
                  >
                    {log.severityText || severityBucket(log).toUpperCase()}
                  </span>
                </td>
                <td class="log-body" title={normalizeBody(log.body)}
                  >{normalizeBody(log.body) || '(empty body)'}</td
                >
                <td class="mono">
                  {#if log.traceId}
                    <a href={`/traces/${log.traceId}`}>{log.traceId}</a>
                  {:else}
                    <span class="muted">Unlinked</span>
                  {/if}
                </td>
                <td class="mono">{log.spanId || '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .logs-panel {
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

  .mono {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }

  .timestamp {
    white-space: nowrap;
  }

  .log-body {
    max-width: 520px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .muted {
    color: var(--text-secondary);
  }

  .severity-badge {
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

  .severity-error {
    color: var(--error-text);
    background: var(--error-bg);
    border-color: var(--error-border);
  }

  .severity-warn {
    color: #92400e;
    background: #fff7ed;
    border-color: #fed7aa;
  }

  .severity-info {
    color: #0f4c81;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .severity-debug,
  .severity-trace {
    color: var(--text-secondary);
    background: var(--bg-surface-hover);
    border-color: var(--border);
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
    .log-body {
      max-width: 280px;
    }
  }

  @media (max-width: 768px) {
    table {
      min-width: 900px;
    }
  }
</style>
