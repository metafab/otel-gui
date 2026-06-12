<script lang="ts">
  import type { LogListItem } from '$lib/types'
  import ServiceBadge from './ServiceBadge.svelte'

  interface Props {
    logs: LogListItem[]
    onSelectLog?: (log: LogListItem) => void
  }

  let { logs, onSelectLog }: Props = $props()

  function getSeverityClass(severityNumber: number) {
    if (severityNumber >= 17) return 'error'
    if (severityNumber >= 13) return 'warn'
    if (severityNumber >= 9) return 'info'
    return 'debug'
  }

  function formatBody(body: any): string {
    if (typeof body === 'string') return body
    try {
      return JSON.stringify(body)
    } catch {
      return String(body)
    }
  }
</script>

<div class="logs-container">
  <div class="table-wrapper">
    <table class="logs-table">
      <thead>
        <tr>
          <th class="time-col">Time</th>
          <th class="sev-col">Severity</th>
          <th class="service-col">Service</th>
          <th class="body-col">Body</th>
          <th class="trace-col">Trace ID</th>
        </tr>
      </thead>
      <tbody>
        {#each logs as log (log.id)}
          <tr onclick={() => onSelectLog?.(log)}>
            <td class="timestamp" title={log.timestamp}>
              {new Date(log.timestamp).toLocaleString()}
            </td>
            <td class="severity">
              <span
                class="severity-badge {getSeverityClass(log.severityNumber)}"
              >
                {log.severityText || `SEV ${log.severityNumber}`}
              </span>
            </td>
            <td><ServiceBadge serviceName={log.serviceName} /></td>
            <td class="body-cell" title={formatBody(log.body)}>
              <div class="body-text">{formatBody(log.body)}</div>
            </td>
            <td class="trace-id">
              {#if log.traceId}
                <a
                  href="/traces/{log.traceId}"
                  onclick={(e) => e.stopPropagation()}
                >
                  {log.traceId.slice(0, 8)}…
                </a>
              {:else}
                <span class="none">-</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .logs-container {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 1px 3px var(--shadow-sm);
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .table-wrapper {
    overflow: auto;
    flex: 1;
  }

  .logs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    table-layout: fixed;
  }

  th {
    text-align: left;
    padding: 0.75rem 1rem;
    background: var(--bg-muted);
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  td {
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }

  tr:hover {
    background: var(--bg-surface-hover);
    cursor: pointer;
  }

  .time-col {
    width: 180px;
  }
  .sev-col {
    width: 120px;
  }
  .service-col {
    width: 180px;
  }
  .trace-col {
    width: 120px;
  }

  .timestamp {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .body-cell {
    max-width: 0;
  }

  .body-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .severity-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .severity-badge.error {
    background: #fee2e2;
    color: #991b1b;
  }
  .severity-badge.warn {
    background: #fef3c7;
    color: #92400e;
  }
  .severity-badge.info {
    background: #e0f2fe;
    color: #075985;
  }
  .severity-badge.debug {
    background: #f1f5f9;
    color: #475569;
  }

  .trace-id a {
    color: var(--accent);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
  }

  .trace-id a:hover {
    text-decoration: underline;
  }

  .none {
    color: var(--text-muted);
    opacity: 0.5;
  }
</style>
