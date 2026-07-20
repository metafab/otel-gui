<script lang="ts">
  // Per-series legend with show/hide checkboxes + an attribute filter input (§5).
  // Drives which lines the parent plots. Shows a "showing N of M series" note;
  // capping is done by the parent (top-N) and the cappedOut count surfaced here.
  import { METRIC_PALETTE, type ChartLine } from '$lib/utils/metricChart'

  interface Props {
    // All lines for the metric (pre-filter), in their natural order.
    lines: ChartLine[]
    // seriesIds the user has unchecked (hidden).
    hidden: Set<string>
    // attribute substring filter text.
    attrFilter: string
    // count plotted after cap, and total matched (for the note).
    plottedCount: number
    matchedCount: number
    cappedOut: number
    onToggle: (seriesId: string) => void
    onAttrFilter: (value: string) => void
  }

  let {
    lines,
    hidden,
    attrFilter,
    plottedCount,
    matchedCount,
    cappedOut,
    onToggle,
    onAttrFilter,
  }: Props = $props()

  // Map each line to the colour it gets when plotted (palette is index-based on
  // the PLOTTED set, but for the legend swatch we use the line's index in the
  // full list so colours stay stable as you toggle — close enough as a hint).
  function swatch(i: number): string {
    return METRIC_PALETTE[i % METRIC_PALETTE.length]
  }
</script>

<div class="legend">
  <div class="legend-controls">
    <input
      type="text"
      class="attr-filter"
      placeholder="Filter series by attribute (e.g. route=/api)…"
      value={attrFilter}
      oninput={(e) => onAttrFilter((e.target as HTMLInputElement).value)}
      aria-label="Filter series by attribute"
    />
    <span class="series-note" data-testid="series-note">
      showing {plottedCount} of {matchedCount} series
      {#if cappedOut > 0}
        <span class="capped"
          >({cappedOut} hidden by top-{plottedCount} cap)</span
        >
      {/if}
    </span>
  </div>

  {#if lines.length > 0}
    <ul class="legend-items">
      {#each lines as line, i (line.seriesId)}
        <li>
          <label class="legend-item" title={line.label}>
            <input
              type="checkbox"
              checked={!hidden.has(line.seriesId)}
              onchange={() => onToggle(line.seriesId)}
              aria-label={`Toggle series ${line.label}`}
            />
            <span class="dot" style={`background:${swatch(i)}`}></span>
            <span class="legend-label">{line.label}</span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .legend {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .legend-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .attr-filter {
    flex: 1;
    min-width: 240px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.8125rem;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .attr-filter:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .series-note {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .capped {
    color: var(--text-muted);
  }

  .legend-items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    max-height: 140px;
    overflow-y: auto;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    cursor: pointer;
    max-width: 320px;
  }

  .legend-item input {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .legend-label {
    font-family: monospace;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
