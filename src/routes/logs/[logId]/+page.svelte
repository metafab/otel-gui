<script lang="ts">
  import { goto } from '$app/navigation'
  import AttributeItem from '$lib/components/AttributeItem.svelte'
  import CopyButton from '$lib/components/CopyButton.svelte'
  import FullscreenValueModal from '$lib/components/FullscreenValueModal.svelte'
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import type { PageProps } from './$types'
  import type { TraceLogDetail } from '$lib/types'
  import { shouldUseHistoryBack } from '$lib/utils/backNavigation'
  import { isInputFocused } from '$lib/utils/keyboard'
  import { formatTimestamp, formatTimestampLocal } from '$lib/utils/time'

  let { params }: PageProps = $props()
  const logId = $derived(params.logId)

  const pageTitle = $derived(`otel-gui - Log ${logId.slice(0, 8)}`)

  let logDetail = $state<TraceLogDetail | null>(null)
  let isLoading = $state(true)
  let loadError = $state<string | null>(null)
  let showShortcuts = $state(false)
  let fullscreenAttr = $state<{ key: string; value: string } | null>(null)

  let attributeFilter = $state('')
  let resourceFilter = $state('')
  let scopeFilter = $state('')

  let attributeFilterEl = $state<HTMLInputElement | null>(null)
  let resourceFilterEl = $state<HTMLInputElement | null>(null)
  let scopeFilterEl = $state<HTMLInputElement | null>(null)

  const filteredAttributes = $derived(
    logDetail
      ? Object.entries(logDetail.attributes)
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([key, value]) => {
            const q = attributeFilter.trim().toLowerCase()
            if (!q) return true
            return (
              key.toLowerCase().includes(q) ||
              JSON.stringify(value).toLowerCase().includes(q)
            )
          })
      : [],
  )

  const filteredResource = $derived(
    logDetail
      ? Object.entries(logDetail.resource)
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([key, value]) => {
            const q = resourceFilter.trim().toLowerCase()
            if (!q) return true
            return (
              key.toLowerCase().includes(q) ||
              JSON.stringify(value).toLowerCase().includes(q)
            )
          })
      : [],
  )

  const filteredScope = $derived(
    logDetail
      ? Object.entries(logDetail.scopeAttributes)
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([key, value]) => {
            const q = scopeFilter.trim().toLowerCase()
            if (!q) return true
            return (
              key.toLowerCase().includes(q) ||
              JSON.stringify(value).toLowerCase().includes(q)
            )
          })
      : [],
  )

  const hasScope = $derived(
    !!(
      logDetail &&
      (logDetail.scopeName ||
        logDetail.scopeVersion ||
        Object.keys(logDetail.scopeAttributes).length > 0)
    ),
  )

  const serviceName = $derived(
    (logDetail?.resource['service.name'] as string) || 'unknown',
  )

  function openFullscreen(key: string, formatted: string) {
    fullscreenAttr = { key, value: formatted }
  }

  function closeFullscreen() {
    fullscreenAttr = null
  }

  function severityBucket(
    detail: TraceLogDetail,
  ): 'trace' | 'debug' | 'info' | 'warn' | 'error' {
    const n = Number(detail.severityNumber) || 0
    if (n >= 17) return 'error'
    if (n >= 13) return 'warn'
    if (n >= 9) return 'info'
    if (n >= 5) return 'debug'
    return 'trace'
  }

  function normalizeBody(body: unknown): string {
    if (body == null) return ''
    if (
      typeof body === 'string' ||
      typeof body === 'number' ||
      typeof body === 'boolean'
    ) {
      return String(body)
    }

    try {
      return JSON.stringify(body, null, 2)
    } catch {
      return ''
    }
  }

  function handleBack() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (
        shouldUseHistoryBack(document.referrer, window.location.origin, '/')
      ) {
        window.history.back()
        return
      }
    }

    void goto('/?tab=logs')
  }

  async function loadLog() {
    if (!logId) {
      loadError = 'No log ID provided.'
      isLoading = false
      return
    }

    isLoading = true
    loadError = null

    try {
      const response = await fetch(`/api/logs/${encodeURIComponent(logId)}`)
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'Log not found.'
            : `Failed to load log: ${response.statusText}`,
        )
      }

      logDetail = await response.json()
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unknown error loading log.'
      logDetail = null
    } finally {
      isLoading = false
    }
  }

  // Reload when route/query selection changes
  $effect(() => {
    if (logId) {
      void loadLog()
    }
  })

  $effect(() => {
    if (typeof document === 'undefined') return

    function handleEscCapture(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (fullscreenAttr) return

      if (showShortcuts) {
        e.preventDefault()
        showShortcuts = false
        return
      }

      const active = document.activeElement
      if (attributeFilterEl && active === attributeFilterEl) {
        e.preventDefault()
        attributeFilter = ''
        attributeFilterEl.blur()
        return
      }

      if (resourceFilterEl && active === resourceFilterEl) {
        e.preventDefault()
        resourceFilter = ''
        resourceFilterEl.blur()
        return
      }

      if (scopeFilterEl && active === scopeFilterEl) {
        e.preventDefault()
        scopeFilter = ''
        scopeFilterEl.blur()
        return
      }

      e.preventDefault()
      handleBack()
    }

    document.addEventListener('keydown', handleEscCapture, { capture: true })
    return () => {
      document.removeEventListener('keydown', handleEscCapture, {
        capture: true,
      })
    }
  })

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcuts = !showShortcuts
    }
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="log-detail-page">
  <header class="header">
    <button class="action-button back-button" onclick={handleBack}>
      ← Back to Logs
    </button>
    {#if logDetail}
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
    {/if}
  </header>

  {#if isLoading}
    <div class="loading">Loading log...</div>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else if logDetail}
    <div class="log-container">
      <section class="log-panel log-identification">
        <div class="log-id-row">
          <h2>Log {logDetail.id}</h2>
          <CopyButton
            text={logDetail.id}
            size={13}
            label="log ID"
            class="log-id-copy-btn"
          />
        </div>

        <div class="log-meta">
          <span class={`severity-badge severity-${severityBucket(logDetail)}`}>
            {logDetail.severityText || severityBucket(logDetail).toUpperCase()}
          </span>
          <span class="separator">•</span>
          <ServiceBadge {serviceName} />
          <span class="separator">•</span>
          {#if logDetail.traceId}
            <a class="mono-link" href={`/traces/${logDetail.traceId}`}>
              trace {logDetail.traceId}
            </a>
          {:else}
            <span class="muted">Unlinked trace</span>
          {/if}
          <span class="separator">•</span>
          {#if logDetail.traceId && logDetail.spanId}
            <a
              class="mono-link"
              href={`/traces/${logDetail.traceId}?spanId=${encodeURIComponent(logDetail.spanId)}`}
            >
              span {logDetail.spanId}
            </a>
          {:else}
            <span class="mono">span {logDetail.spanId || '-'}</span>
          {/if}
        </div>

        <div class="log-timestamps">
          <div class="timestamp-item">
            <span class="timestamp-label">Time:</span>
            <span
              class="timestamp-value"
              title={formatTimestamp(logDetail.timeUnixNano)}
              >{formatTimestampLocal(logDetail.timeUnixNano)}</span
            >
          </div>
          <div class="timestamp-item">
            <span class="timestamp-label">Observed:</span>
            <span
              class="timestamp-value"
              title={formatTimestamp(logDetail.observedTimeUnixNano)}
              >{formatTimestampLocal(logDetail.observedTimeUnixNano)}</span
            >
          </div>
        </div>
      </section>

      <div class="details-grid">
        <section class="section">
          <h3>Body</h3>
          <pre class="body-value">{normalizeBody(logDetail.body) ||
              '(empty body)'}</pre>
        </section>

        <section class="section">
          <div class="section-heading">
            <h3>Attributes ({Object.keys(logDetail.attributes).length})</h3>
            <input
              type="text"
              bind:value={attributeFilter}
              bind:this={attributeFilterEl}
              placeholder="Filter attributes..."
              class="filter-input"
            />
          </div>

          {#if filteredAttributes.length > 0}
            <div class="attributes">
              {#each filteredAttributes as [key, value]}
                <AttributeItem
                  attrKey={key}
                  {value}
                  onFullscreen={openFullscreen}
                />
              {/each}
            </div>
          {:else}
            <div class="empty-inline">No matching attributes.</div>
          {/if}
        </section>

        <section class="section">
          <div class="section-heading">
            <h3>Resource ({Object.keys(logDetail.resource).length})</h3>
            <input
              type="text"
              bind:value={resourceFilter}
              bind:this={resourceFilterEl}
              placeholder="Filter resource attributes..."
              class="filter-input"
            />
          </div>

          {#if filteredResource.length > 0}
            <div class="attributes">
              {#each filteredResource as [key, value]}
                <AttributeItem
                  attrKey={key}
                  {value}
                  onFullscreen={openFullscreen}
                />
              {/each}
            </div>
          {:else}
            <div class="empty-inline">No matching resource attributes.</div>
          {/if}
        </section>

        {#if hasScope}
          <section class="section">
            <div class="section-heading">
              <h3>Scope</h3>
              <input
                type="text"
                bind:value={scopeFilter}
                bind:this={scopeFilterEl}
                placeholder="Filter scope attributes..."
                class="filter-input"
              />
            </div>

            {#if logDetail.scopeName}
              <div class="detail-row">
                <span class="label">Name:</span>
                <span class="value mono">{logDetail.scopeName}</span>
              </div>
            {/if}

            {#if logDetail.scopeVersion}
              <div class="detail-row">
                <span class="label">Version:</span>
                <span class="value mono">{logDetail.scopeVersion}</span>
              </div>
            {/if}

            {#if filteredScope.length > 0}
              <div class="attributes">
                {#each filteredScope as [key, value]}
                  <AttributeItem
                    attrKey={key}
                    {value}
                    onFullscreen={openFullscreen}
                  />
                {/each}
              </div>
            {:else if Object.keys(logDetail.scopeAttributes).length > 0}
              <div class="empty-inline">No matching scope attributes.</div>
            {:else}
              <div class="empty-inline">No scope attributes.</div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<FullscreenValueModal attr={fullscreenAttr} onclose={closeFullscreen} />

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      {
        keys: ['Esc'],
        description: 'Back to logs (or clear focused section filter)',
      },
      { keys: ['?'], description: 'Toggle keyboard shortcuts help' },
    ]}
    onclose={() => (showShortcuts = false)}
  />
{/if}

<style>
  .log-detail-page {
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-page);
  }

  .header {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .loading,
  .error {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .error {
    color: var(--error-text);
  }

  .log-container {
    width: 100%;
    padding: 0.75rem 0.75rem 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .log-panel {
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
    margin-right: 0;
  }

  .log-identification {
    margin-bottom: 1.25rem;
  }

  .log-id-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .log-id-row h2 {
    font-size: 1.25rem;
    margin: 0;
    font-family: monospace;
    word-break: break-all;
  }

  :global(.log-id-copy-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    flex-shrink: 0;
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
  }

  :global(.log-id-copy-btn:hover) {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  :global(.log-id-copy-btn.copied) {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .log-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .separator {
    color: var(--border-sep);
  }

  .mono,
  .mono-link {
    font-family: monospace;
    word-break: break-all;
  }

  .mono-link {
    color: var(--accent);
    text-decoration: none;
  }

  .mono-link:hover {
    text-decoration: underline;
  }

  .muted {
    color: var(--text-muted);
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

  .log-timestamps {
    display: flex;
    gap: 1.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-light);
    flex-wrap: wrap;
  }

  .timestamp-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .timestamp-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .timestamp-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-family: monospace;
  }

  .details-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    padding-bottom: 2rem;
  }

  .section {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }

  .section h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .section h3 + .body-value {
    margin-top: 0.875rem;
  }

  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .filter-input {
    min-width: 240px;
    max-width: 360px;
    font-size: 0.8125rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .filter-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--attr-string-bg);
  }

  .body-value {
    margin: 0;
    font-family: monospace;
    font-size: 0.95rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    max-height: 420px;
    overflow: auto;
    background: var(--bg-code);
    border: 1px solid var(--border-light);
    border-radius: 6px;
    padding: 0.75rem;
  }

  .attributes {
    border-top: 1px solid var(--border-light);
    margin-top: 0.5rem;
  }

  .detail-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .label {
    width: 70px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .value {
    color: var(--text-primary);
  }

  .empty-inline {
    font-size: 0.8125rem;
    color: var(--text-muted);
    padding: 0.5rem 0;
  }

  @media (max-width: 860px) {
    .header {
      padding: 0.75rem 1rem;
    }

    .section-heading {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-input {
      max-width: 100%;
      min-width: 0;
    }
  }
</style>
