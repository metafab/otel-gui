<script lang="ts">
  import ChevronIcon from '$lib/components/ChevronIcon.svelte'
  import CopyButton from '$lib/components/CopyButton.svelte'
  import ServiceMap from '$lib/components/ServiceMap.svelte'
  import { formatTimestamp, formatTimestampLocal } from '$lib/utils/time'
  import type { StoredTrace, ServiceMapData } from '$lib/types'

  interface Props {
    trace: StoredTrace
    serviceCount: number
    maxDepth: number
    traceDuration: { simple: string; detailed: string }
    miniMapData: ServiceMapData | null
    miniMapLoading: boolean
    showMiniMap: boolean
  }

  let {
    trace,
    serviceCount,
    maxDepth,
    traceDuration,
    miniMapData,
    miniMapLoading,
    showMiniMap = $bindable(false),
  }: Props = $props()
</script>

<section class="trace-identification">
  <div class="trace-id-row">
    <h2>Trace {trace.traceId}</h2>
    <CopyButton
      text={trace.traceId}
      size={13}
      label="trace ID"
      class="trace-id-copy-btn"
    />
  </div>
  <div class="trace-meta">
    <span class="service">{trace.serviceName}</span>
    <span class="separator">•</span>
    <span class="root-span">{trace.rootSpanName}</span>
    <span class="separator">•</span>
    <span class="spans"
      >{trace.spanCount} span{trace.spanCount !== 1 ? 's' : ''}</span
    >
    <span class="separator">•</span>
    <span class="services"
      >{serviceCount} service{serviceCount !== 1 ? 's' : ''}</span
    >
    <span class="separator">•</span>
    <span class="depth">depth {maxDepth}</span>
    {#if trace.hasError}
      <span class="separator">•</span>
      <span class="error-badge">ERROR</span>
    {/if}
  </div>
  <div class="trace-timestamps">
    <div class="timestamp-item">
      <span class="timestamp-label">Started:</span>
      <span
        class="timestamp-value"
        title={formatTimestamp(trace.startTimeUnixNano)}
        >{formatTimestampLocal(trace.startTimeUnixNano)}</span
      >
    </div>
    <div class="timestamp-item">
      <span class="timestamp-label">Ended:</span>
      <span
        class="timestamp-value"
        title={formatTimestamp(trace.endTimeUnixNano)}
        >{formatTimestampLocal(trace.endTimeUnixNano)}</span
      >
    </div>
    <div class="timestamp-item">
      <span class="timestamp-label">Duration:</span>
      <span class="timestamp-value" title={traceDuration.detailed}
        >{traceDuration.simple}</span
      >
    </div>
  </div>

  <!-- Mini Service Map -->
  {#if miniMapData && (miniMapData.nodes.length > 1 || miniMapData.edges.length > 0)}
    <div class="mini-map-section">
      <button
        class="mini-map-toggle"
        onclick={() => (showMiniMap = !showMiniMap)}
        aria-expanded={showMiniMap}
      >
        <ChevronIcon expanded={showMiniMap} />
        Service Map
        <span class="mini-map-count"
          >{miniMapData.nodes.length} service{miniMapData.nodes.length !== 1
            ? 's'
            : ''} · {miniMapData.edges.length} edge{miniMapData.edges.length !==
          1
            ? 's'
            : ''}</span
        >
      </button>
      {#if showMiniMap}
        <div class="mini-map-wrap">
          {#if miniMapLoading}
            <div class="mini-map-loading">Loading…</div>
          {:else}
            <ServiceMap data={miniMapData} mini={true} />
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .trace-identification {
    background: var(--bg-surface);
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
  }

  .trace-id-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .trace-identification h2 {
    font-size: 1.25rem;
    margin: 0;
    font-family: monospace;
  }

  /* Style the CopyButton inside the header row */
  :global(.trace-id-copy-btn) {
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

  :global(.trace-id-copy-btn):hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  :global(.trace-id-copy-btn.copied) {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .trace-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .trace-timestamps {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-light);
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

  /* Mini service map */
  .mini-map-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-light);
  }

  .mini-map-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: color 0.15s ease;
  }

  .mini-map-toggle:hover {
    color: var(--text-primary);
  }

  .mini-map-count {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .mini-map-wrap {
    margin-top: 0.75rem;
    overflow: hidden;
  }

  .mini-map-loading {
    padding: 1rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .separator {
    color: var(--border-sep);
  }

  .service {
    font-weight: 600;
    color: var(--accent);
  }

  .root-span {
    font-family: monospace;
  }

  .error-badge {
    background: var(--error-bg);
    color: var(--error-text);
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
  }
</style>
