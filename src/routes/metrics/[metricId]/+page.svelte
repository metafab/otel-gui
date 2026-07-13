<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { onMount } from 'svelte'
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'
  import UplotChart from '$lib/components/UplotChart.svelte'
  import HistogramHeatmap from '$lib/components/HistogramHeatmap.svelte'
  import MetricSeriesLegend from '$lib/components/MetricSeriesLegend.svelte'
  import type { MetricDetail } from '$lib/types'
  import { shouldUseHistoryBackForTarget } from '$lib/utils/returnNavigation'
  import { isInputFocused } from '$lib/utils/keyboard'
  import {
    buildLines,
    filterLines,
    buildAlignedData,
    defaultValueMode,
    DEFAULT_SERIES_CAP,
    type ValueMode,
  } from '$lib/utils/metricChart'
  import type uPlot from 'uplot'

  const metricId = $derived($page.params.metricId ?? '')

  let metric = $state<MetricDetail | null>(null)
  let isLoading = $state(true)
  let loadError = $state<string | null>(null)
  let removed = $state(false)
  let showShortcuts = $state(false)

  // §4 raw↔rate toggle (sum only). Defaulted once per metric in the effect below.
  let valueMode = $state<ValueMode>('raw')
  let valueModeInitialised = $state(false)

  // §5 series filtering state.
  let hiddenSeries = $state<Set<string>>(new Set())
  let attrFilter = $state('')

  const isLineType = $derived(
    metric != null &&
      (metric.type === 'gauge' ||
        metric.type === 'sum' ||
        metric.type === 'summary'),
  )
  const isHistType = $derived(
    metric != null &&
      (metric.type === 'histogram' || metric.type === 'exp_histogram'),
  )

  const pageTitle = $derived(
    metric ? `otel-gui - ${metric.name}` : 'otel-gui - Metric',
  )

  // Pick the rate default once, when the metric type/flags first land.
  $effect(() => {
    if (metric && !valueModeInitialised) {
      valueMode = defaultValueMode(metric)
      valueModeInitialised = true
    }
  })

  // All plottable lines for the line-chart types (gauge/sum/summary), built from
  // the chosen valueMode (rate uses each point's server-computed `rate`).
  const allLines = $derived.by(() => {
    if (!metric || !isLineType) return []
    return buildLines(metric, valueMode)
  })

  // Apply attribute filter + hidden set + top-N cap.
  const filtered = $derived(
    filterLines(allLines, {
      attrFilter,
      hidden: hiddenSeries,
      cap: DEFAULT_SERIES_CAP,
    }),
  )

  // uPlot AlignedData for the plotted lines.
  const chart = $derived.by(() => {
    const build = buildAlignedData(filtered.plotted)
    return {
      data: build.data as uPlot.AlignedData,
      series: build.series as unknown as uPlot.Series[],
    }
  })

  // Histogram views render the first matching series (kept readable; the legend
  // is line-chart only). Multi-series histograms still show their busiest one.
  const histPoints = $derived(
    metric && isHistType && metric.series.length > 0
      ? metric.series[0].points
      : [],
  )

  function toggleSeries(seriesId: string) {
    const next = new Set(hiddenSeries)
    if (next.has(seriesId)) next.delete(seriesId)
    else next.add(seriesId)
    hiddenSeries = next
  }

  const lastUpdatedLabel = $derived(
    metric ? new Date(metric.lastUpdated).toLocaleString() : '-',
  )

  function handleBack() {
    const target = '/?tab=metrics'

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (
        shouldUseHistoryBackForTarget(
          document.referrer,
          window.location.origin,
          target,
        )
      ) {
        window.history.back()
        return
      }
    }

    void goto(target)
  }

  async function loadMetric() {
    if (!metricId) {
      loadError = 'No metric ID provided.'
      isLoading = false
      return
    }

    isLoading = true
    loadError = null
    removed = false

    try {
      const response = await fetch(
        `/api/metrics/${encodeURIComponent(metricId)}`,
      )
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'Metric not found.'
            : `Failed to load metric: ${response.statusText}`,
        )
      }

      metric = await response.json()
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unknown error loading metric.'
      metric = null
    } finally {
      isLoading = false
    }
  }

  // Initial fetch + live stream. The detail stream RE-SENDS the full bounded
  // snapshot each tick, so we REPLACE state (never append).
  onMount(() => {
    if (!metricId) {
      loadError = 'No metric ID provided.'
      isLoading = false
      return
    }

    void loadMetric()

    if (typeof EventSource === 'undefined') return

    const es = new EventSource(
      `/api/metrics/${encodeURIComponent(metricId)}/stream`,
    )

    es.addEventListener('metric-snapshot', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        metric = data
        removed = false
        loadError = null
      } catch {
        // Ignore malformed payloads; the next snapshot will re-sync.
      } finally {
        isLoading = false
      }
    })

    es.addEventListener('metric-removed', () => {
      removed = true
    })

    es.onerror = () => {
      // EventSource auto-reconnects; the reconnect replays a fresh snapshot.
    }

    return () => es.close()
  })

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcuts = !showShortcuts
      return
    }
    if (e.key === 'Escape' && !isInputFocused()) {
      if (showShortcuts) {
        showShortcuts = false
        return
      }
      handleBack()
    }
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="metric-detail-page">
  <header class="header">
    <button class="action-button back-button" onclick={handleBack}>
      ← Back to Metrics
    </button>
    {#if metric}
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
    {/if}
  </header>

  {#if isLoading}
    <div class="loading">Loading metric...</div>
  {:else if loadError}
    <div class="error">{loadError}</div>
  {:else if metric}
    <div class="metric-container">
      <section class="metric-panel">
        <h2 class="metric-title">{metric.name}</h2>
        {#if metric.description}
          <p class="metric-description">{metric.description}</p>
        {/if}

        <div class="metric-meta">
          <span class={`type-badge type-${metric.type}`}>{metric.type}</span>
          <span class="separator">•</span>
          <ServiceBadge serviceName={metric.serviceName || 'unknown'} />
          {#if metric.unit}
            <span class="separator">•</span>
            <span class="meta-item">unit <code>{metric.unit}</code></span>
          {/if}
          {#if metric.temporality}
            <span class="separator">•</span>
            <span class="meta-item">{metric.temporality}</span>
          {/if}
          {#if metric.type === 'sum' && typeof metric.isMonotonic === 'boolean'}
            <span class="separator">•</span>
            <span class="meta-item"
              >{metric.isMonotonic ? 'monotonic' : 'non-monotonic'}</span
            >
          {/if}
          <span class="separator">•</span>
          <span class="meta-item">{metric.series.length} series</span>
          <span class="separator">•</span>
          <span
            class="meta-item"
            title={new Date(metric.lastUpdated).toISOString()}
            >updated {lastUpdatedLabel}</span
          >
        </div>
      </section>

      {#if removed}
        <div class="notice">
          This metric has been cleared or evicted on the server. The chart below
          shows the last data received.
        </div>
      {/if}

      <section class="chart-panel">
        {#if metric.series.length === 0}
          <div class="empty-inline">No data points yet.</div>
        {:else if isHistType}
          <HistogramHeatmap
            points={histPoints}
            unit={metric.unit}
            height={380}
          />
          {#if metric.series.length > 1}
            <div class="hist-note">
              Showing series 1 of {metric.series.length}. Histogram views render
              one series at a time.
            </div>
          {/if}
        {:else}
          <div class="chart-controls">
            {#if metric.type === 'sum'}
              <div class="value-mode" role="group" aria-label="Value mode">
                <button
                  type="button"
                  class="seg"
                  class:active={valueMode === 'raw'}
                  aria-pressed={valueMode === 'raw'}
                  onclick={() => (valueMode = 'raw')}>Raw</button
                >
                <button
                  type="button"
                  class="seg"
                  class:active={valueMode === 'rate'}
                  aria-pressed={valueMode === 'rate'}
                  onclick={() => (valueMode = 'rate')}>Rate /s</button
                >
              </div>
            {/if}
          </div>

          {#if chart.data[0].length === 0}
            <div class="empty-inline">
              {#if metric.type === 'sum' && valueMode === 'rate'}
                No rate data yet (needs at least two points per series).
              {:else}
                No data points yet.
              {/if}
            </div>
          {:else}
            <UplotChart data={chart.data} series={chart.series} height={380} />
          {/if}

          <MetricSeriesLegend
            lines={allLines}
            hidden={hiddenSeries}
            {attrFilter}
            plottedCount={filtered.plotted.length}
            matchedCount={filtered.matched.length}
            cappedOut={filtered.cappedOut}
            onToggle={toggleSeries}
            onAttrFilter={(v) => (attrFilter = v)}
          />
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      { keys: ['Esc'], description: 'Back to metrics' },
      { keys: ['?'], description: 'Toggle keyboard shortcuts help' },
    ]}
    onclose={() => (showShortcuts = false)}
  />
{/if}

<style>
  .metric-detail-page {
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

  .metric-container {
    width: 100%;
    padding: 0.75rem 0.75rem 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .metric-panel {
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
    margin-bottom: 1rem;
  }

  .metric-title {
    font-size: 1.25rem;
    margin: 0;
    font-family: monospace;
    word-break: break-all;
  }

  .metric-description {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .metric-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.875rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .meta-item code {
    font-family: monospace;
  }

  .separator {
    color: var(--border-sep);
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

  .chart-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .value-mode {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .value-mode .seg {
    padding: 0.35rem 0.85rem;
    background: var(--bg-surface);
    border: none;
    border-right: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .value-mode .seg:last-child {
    border-right: none;
  }

  .value-mode .seg.active {
    background: var(--accent);
    color: #fff;
  }

  .hist-note {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .chart-panel {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 2rem;
  }

  .notice {
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    background: var(--bg-muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .empty-inline {
    font-size: 0.8125rem;
    color: var(--text-muted);
    padding: 1rem 0;
    text-align: center;
  }

  @media (max-width: 860px) {
    .header {
      padding: 0.75rem 1rem;
    }
  }
</style>
