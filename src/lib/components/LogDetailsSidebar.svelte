<script lang="ts">
  import type { TraceLogDetail } from '$lib/types'
  import AttributeItem from './AttributeItem.svelte'
  import { formatTimestampLocal } from '$lib/utils/time'

  interface Props {
    log: TraceLogDetail
    onClose: () => void
    onFullscreen?: (key: string, formatted: string) => void
  }

  let { log, onClose, onFullscreen }: Props = $props()

  function getSeverityClass(severityNumber: number) {
    if (severityNumber >= 17) return 'error'
    if (severityNumber >= 13) return 'warn'
    if (severityNumber >= 9) return 'info'
    return 'debug'
  }
</script>

<div class="sidebar">
  <header>
    <div class="header-main">
      <button class="close-btn" onclick={onClose} aria-label="Close sidebar"
        >✕</button
      >
      <h2>Log Detail</h2>
    </div>
    <div class="timestamp">
      {formatTimestampLocal(log.timeUnixNano || log.observedTimeUnixNano)}
    </div>
  </header>

  <div class="content">
    <section class="overview">
      <div class="info-grid">
        <div class="info-item">
          <label>Severity</label>
          <span class="severity-badge {getSeverityClass(log.severityNumber)}">
            {log.severityText || `SEV ${log.severityNumber}`}
          </span>
        </div>
        <div class="info-item">
          <label>Service</label>
          <div class="value">{log.resource['service.name'] || 'unknown'}</div>
        </div>
        {#if log.traceId}
          <div class="info-item">
            <label>Trace ID</label>
            <div class="value monospace">
              <a href="/traces/{log.traceId}">{log.traceId}</a>
            </div>
          </div>
        {/if}
        {#if log.spanId}
          <div class="info-item">
            <label>Span ID</label>
            <div class="value monospace">{log.spanId}</div>
          </div>
        {/if}
      </div>
    </section>

    <section class="body-section">
      <h3>Body</h3>
      <div class="body-content">
        {#if typeof log.body === 'object' && log.body !== null}
          <pre>{JSON.stringify(log.body, null, 2)}</pre>
        {:else}
          <p>{log.body}</p>
        {/if}
      </div>
    </section>

    <section class="attributes-section">
      <h3>Attributes</h3>
      <div class="attributes-list">
        {#each Object.entries(log.attributes) as [attrKey, value]}
          <AttributeItem {attrKey} {value} {onFullscreen} />
        {:else}
          <div class="empty">No attributes</div>
        {/each}
      </div>
    </section>

    <section class="resource-section">
      <h3>Resource</h3>
      <div class="attributes-list">
        {#each Object.entries(log.resource) as [attrKey, value]}
          <AttributeItem {attrKey} {value} {onFullscreen} />
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .sidebar {
    width: 450px;
    height: 100%;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 8px var(--shadow-sm);
  }

  header {
    padding: 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .header-main {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.25rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .timestamp {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  h3 {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }

  .info-item label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
  }

  .info-item .value {
    font-size: 0.875rem;
    word-break: break-all;
  }

  .monospace {
    font-family: var(--font-mono);
  }

  .severity-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
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

  .body-content {
    background: var(--bg-muted);
    padding: 1rem;
    border-radius: 4px;
    font-size: 0.875rem;
    border: 1px solid var(--border);
    max-height: 300px;
    overflow: auto;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .attributes-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .empty {
    padding: 1rem;
    background: var(--bg-surface);
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
