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

  const selectedLogIdSet = $derived(new Set(selectedLogIds))
  const selectedFilteredCount = $derived(
    filteredLogs.filter((log) => selectedLogIdSet.has(log.id)).length,
  )
  const allFilteredSelected = $derived(
    filteredLogs.length > 0 && selectedFilteredCount === filteredLogs.length,
  )

  $effect(() => {
    const visibleIds = new Set(filteredLogs.map((log) => log.id))
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
    selectedLogIds = filteredLogs
      .filter((log) => !selectedLogIdSet.has(log.id))
      .map((log) => log.id)
  }

  function toggleLogSelection(logId: string) {
    if (selectedLogIdSet.has(logId)) {
      selectedLogIds = selectedLogIds.filter((id) => id !== logId)
      return
    }

    selectedLogIds = [...selectedLogIds, logId]
  }

  $effect(() => {
    void loadLogs()
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
      filteredCount={filteredLogs.length}
      totalCount={logs.length}
    />

    {#if filteredLogs.length === 0}
      <div class="empty">
        <p>No logs match the current filters.</p>
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
              <th>Time</th>
              <th>Service</th>
              <th>Severity</th>
              <th>Body</th>
              <th>Trace</th>
              <th>Span</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredLogs as log (log.id)}
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
