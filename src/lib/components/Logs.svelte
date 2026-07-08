<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import LogsFilter from '$lib/components/LogsFilter.svelte'
  import VersionInfo from '$lib/components/VersionInfo.svelte'
  import { onSSEEvents } from '$lib/stores/sseClient'
  import { traceStore } from '$lib/stores/traces.svelte'
  import type { LogListItem } from '$lib/types'
  import { formatTimestampLocal } from '$lib/utils/time'

  // Bindable props so parent can read reactive state for header action buttons
  let {
    totalCount = $bindable(0),
    selectedCount = $bindable(0),
    isDeletingBound = $bindable(false),
  } = $props()

  let logs = $state.raw<LogListItem[]>([])
  // Only true until the first snapshot (or fallback load) arrives. Background
  // delta updates never toggle this, so the table is never torn down/remounted.
  let isLoading = $state(true)
  let loadError = $state<string | null>(null)
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

  function parseSeverityFilter(
    rawValue: string | null,
  ): 'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error' {
    switch (rawValue) {
      case 'trace':
      case 'debug':
      case 'info':
      case 'warn':
      case 'error':
        return rawValue
      default:
        return 'all'
    }
  }

  function readParamsFromLocation() {
    if (typeof window === 'undefined') {
      return {
        searchQuery: '',
        severityFilter: 'all',
        selectedService: 'all',
        sortBy: DEFAULT_SORT_BY,
        sortOrder: DEFAULT_SORT_ORDER,
      } as const
    }

    const url = new URL(window.location.href)
    return {
      searchQuery: url.searchParams.get('search') ?? '',
      severityFilter: parseSeverityFilter(url.searchParams.get('severity')),
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

    if (severityFilter !== 'all') {
      url.searchParams.set('severity', severityFilter)
    } else {
      url.searchParams.delete('severity')
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
  let severityFilter = $state<
    'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error'
  >(initialParams.severityFilter)
  let selectedService = $state<string>(initialParams.selectedService)
  let sortBy = $state<LogSortBy>(initialParams.sortBy)
  let sortOrder = $state<LogSortOrder>(initialParams.sortOrder)
  let selectedLogIds = $state<string[]>([])
  let isDeleting = $state(false)

  const otlpLogsEndpoint = $derived.by(() => {
    if (typeof window !== 'undefined') {
      const { protocol, hostname, port } = window.location
      return `${protocol}//${hostname}${port ? ':' + port : ''}/v1/logs`
    }
    return 'http://localhost:4318/v1/logs'
  })
  const maxLogs = $derived(traceStore.maxLogs)
  const persistence = $derived(traceStore.persistence)

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
    applyParams(nextUrl)
    if (nextUrl.search === window.location.search) return
    try {
      replaceState(nextUrl, {})
    } catch {
      // Component tests can run before SvelteKit router bootstraps.
      window.history.replaceState(window.history.state, '', nextUrl)
    }
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

  const services = $derived(
    Array.from(
      new Set(logs.map((log) => log.serviceName).filter(Boolean)),
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

  const filteredLogs = $derived.by(() => {
    if (!Array.isArray(logs)) return []
    const query = searchQuery.trim().toLowerCase()

    return logs.filter((log) => {
      if (severityFilter !== 'all' && severityBucket(log) !== severityFilter) {
        return false
      }

      if (selectedService !== 'all' && log.serviceName !== selectedService) {
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

  // Fallback for environments without EventSource — the live view is otherwise
  // driven entirely by the SSE snapshot/append stream (see the $effect below).
  // `shouldApply` lets the caller discard a slow REST response if a live SSE
  // snapshot has already updated the list in the meantime (avoids a stale seed
  // clobbering fresher data during a concurrent clear/delete).
  async function loadLogs(shouldApply: () => boolean = () => true) {
    isLoading = true
    loadError = null
    try {
      const response = await fetch('/api/logs?limit=5000')
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`)
      }
      const data = await response.json()
      if (shouldApply()) logs = data
    } catch (error) {
      if (shouldApply()) {
        loadError =
          error instanceof Error ? error.message : 'Unknown error loading logs'
        logs = []
      }
    } finally {
      isLoading = false
    }
  }

  function logTimeNano(log: LogListItem): bigint {
    return BigInt(log.timeUnixNano || log.observedTimeUnixNano || '0')
  }

  // Merge newly-streamed logs into the existing list (upsert by id) without
  // refetching everything, then cap to maxLogs to mirror the server's eviction.
  function applyAppend(incoming: LogListItem[]) {
    if (incoming.length === 0) return

    const byId = new Map<string, LogListItem>()
    for (const log of logs) byId.set(log.id, log)
    for (const log of incoming) byId.set(log.id, log)

    let merged = Array.from(byId.values())
    if (merged.length > maxLogs) {
      merged.sort((a, b) => {
        const at = logTimeNano(a)
        const bt = logTimeNano(b)
        return bt > at ? 1 : bt < at ? -1 : 0
      })
      merged = merged.slice(0, maxLogs)
    }

    logs = merged
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

  function handleRowClick(logId: string) {
    // Client-side navigation — see Traces.svelte: a full-page load tears down and
    // re-establishes every SSE stream on each open, stalling against the browser's
    // 6-connection-per-origin limit.
    void goto(`/logs/${logId}`)
  }

  // Keyboard activation for the row (Enter/Space), only when the row itself —
  // not a child control like the select checkbox — is focused.
  function handleRowKeydown(event: KeyboardEvent, logId: string) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(logId)
    }
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
    selectedService = 'all'
  }

  $effect(() => {
    // Seed the current list once on mount. The shared SSE connection only
    // replays its snapshot at connect time (page load) — this component mounts
    // later, when the Logs tab is opened, so it would otherwise miss the initial
    // snapshot and stay empty until the next ingest. REST gives the initial
    // paint; live deltas (append) and clear/delete re-syncs (snapshot) follow.
    //
    // If an SSE snapshot lands while that REST seed is still in flight (e.g. a
    // concurrent clear), the seed must not overwrite it — track that here.
    let sseSnapshotApplied = false
    void loadLogs(() => !sseSnapshotApplied)

    // No EventSource (SSR/legacy) — the REST load above is all we get.
    if (typeof EventSource === 'undefined') return

    // Log list events arrive over the shared app-wide SSE connection.
    return onSSEEvents({
      // Full list: re-sent after any clear/delete (re-sync).
      'logs-snapshot': (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          logs = Array.isArray(data.logs) ? data.logs : []
          loadError = null
          sseSnapshotApplied = true
        } catch {
          // Ignore malformed payloads; the next snapshot will re-sync.
        } finally {
          isLoading = false
        }
      },
      // Incremental: only logs ingested since the last cursor. Merged in place so
      // the table updates without a full re-render (no flash).
      'logs-append': (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          if (Array.isArray(data.logs)) applyAppend(data.logs)
        } catch {
          // Ignore malformed payloads.
        }
      },
    })
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
      {services}
      bind:searchQuery
      bind:severityFilter
      bind:selectedService
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
                  <span class="sort-indicator"
                    >{getSortIndicator('service')}</span
                  >
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
                  <span class="sort-indicator"
                    >{getSortIndicator('severity')}</span
                  >
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
                  <span class="sort-indicator">{getSortIndicator('trace')}</span
                  >
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
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <tr
                onclick={() => handleRowClick(log.id)}
                onkeydown={(e) => handleRowKeydown(e, log.id)}
                tabindex="0"
                data-testid="log-row"
                data-log-id={log.id}
                class:selected={selectedLogIdSet.has(log.id)}
              >
                <td
                  class="select-col"
                  onclick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    class="row-checkbox"
                    checked={selectedLogIdSet.has(log.id)}
                    onchange={() => toggleLogSelection(log.id)}
                    aria-label={`Select log ${log.id}`}
                  />
                </td>
                <td class="timestamp" title={formatLogTimeTitle(log)}
                  >{formatLogTime(log)}</td
                >
                <td
                  ><ServiceBadge
                    serviceName={log.serviceName || 'unknown'}
                  /></td
                >
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
                    <a
                      href={`/traces/${log.traceId}`}
                      onclick={(event) => event.stopPropagation()}
                    >
                      {log.traceId}
                    </a>
                  {:else}
                    <span class="muted">Unlinked</span>
                  {/if}
                </td>
                <td class="mono">
                  {#if log.traceId && log.spanId}
                    <a
                      href={`/traces/${log.traceId}?spanId=${encodeURIComponent(log.spanId)}`}
                      onclick={(event) => event.stopPropagation()}
                    >
                      {log.spanId}
                    </a>
                  {:else}
                    {log.spanId || '-'}
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
        title="Set OTEL_GUI_MAX_LOGS=<number> (1–10 000) and restart to change this limit."
        >{maxLogs}</span
      >
      logs
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
    overflow: hidden;
    text-overflow: ellipsis;
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
