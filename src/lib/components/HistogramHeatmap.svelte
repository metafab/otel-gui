<script lang="ts">
  // Histogram + exp_histogram views (§1/§2). Two modes:
  //   (a) Distribution — bars of the LATEST point's bucket counts (SVG, the
  //       simple must-have view). SSR-safe (no canvas).
  //   (b) Heatmap — x = time, y = bucket, colour = count, drawn to a
  //       self-contained <canvas>. The canvas is created ONCE; live appends
  //       redraw into the existing element via an $effect (never remount), to
  //       honour the flicker-free contract.
  import { onMount } from 'svelte'
  import {
    bucketsForPoint,
    latestHistPoint,
    isHistogramPoint,
    isExpHistogramPoint,
    type DistBucket,
  } from '$lib/utils/histogram'
  import type { MetricWirePoint } from '$lib/types'

  interface Props {
    // Points of the chosen series (already type-narrowed to histogram-ish).
    points: MetricWirePoint[]
    unit?: string
    height?: number
  }

  let { points, unit = '', height = 360 }: Props = $props()

  let view = $state<'distribution' | 'heatmap'>('distribution')
  let canvasEl = $state<HTMLCanvasElement | null>(null)
  let canvasWrapEl = $state<HTMLDivElement | null>(null)
  let canvasWidth = $state(600)
  let mounted = $state(false)

  // ── Distribution (latest point) ────────────────────────────────────────────
  const latest = $derived(latestHistPoint(points))
  const distBuckets = $derived<DistBucket[]>(
    latest ? bucketsForPoint(latest) : [],
  )
  const maxCount = $derived(
    distBuckets.reduce((m, b) => (b.count > m ? b.count : m), 0),
  )
  const latestTimeLabel = $derived(
    latest ? new Date(latest.t).toLocaleTimeString() : '',
  )

  // ── Heatmap rows: union of bucket layouts across time ───────────────────────
  // Each time-column is one histogram point; a row is a bucket index. We use the
  // LATEST point's bucket layout for the row axis (bucket layout is stable per
  // series in practice) and align every column's counts onto it by index.
  interface HeatColumn {
    t: number
    counts: number[]
  }

  const heat = $derived.by(() => {
    const cols: HeatColumn[] = []
    let rowLabels: string[] = []
    let maxC = 0

    const histPoints = points.filter(
      (p) => isHistogramPoint(p) || isExpHistogramPoint(p),
    )
    // Time-ordered.
    const sorted = [...histPoints].sort((a, b) => a.t - b.t)

    // Row axis = buckets of the latest point.
    if (latest) {
      rowLabels = bucketsForPoint(latest).map((b) => b.label)
    }
    const rowCount = rowLabels.length

    for (const p of sorted) {
      const buckets = bucketsForPoint(p)
      const counts = new Array(rowCount).fill(0)
      // Align by index against the latest layout (best-effort for varying
      // layouts; identical layouts map 1:1).
      for (let i = 0; i < Math.min(rowCount, buckets.length); i++) {
        counts[i] = buckets[i].count
        if (counts[i] > maxC) maxC = counts[i]
      }
      cols.push({ t: p.t, counts })
    }

    return { cols, rowLabels, maxC }
  })

  function colorFor(count: number, maxC: number): string {
    if (count <= 0) return 'transparent'
    // Perceptual-ish blue ramp; log scale so small counts stay visible.
    const norm = maxC > 1 ? Math.log1p(count) / Math.log1p(maxC) : 1
    const t = Math.max(0.08, Math.min(1, norm))
    // light -> dark blue
    const r = Math.round(219 - t * (219 - 30))
    const g = Math.round(234 - t * (234 - 64))
    const b = Math.round(254 - t * (254 - 175))
    return `rgb(${r}, ${g}, ${b})`
  }

  function drawHeatmap() {
    const canvas = canvasEl
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { cols, rowLabels, maxC } = heat
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

    const padLeft = 70
    const padBottom = 22
    const padTop = 8
    const padRight = 8
    const w = canvasWidth
    const h = height

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const rowCount = rowLabels.length
    if (cols.length === 0 || rowCount === 0) {
      ctx.fillStyle = '#888'
      ctx.font = '12px sans-serif'
      ctx.fillText('No histogram data yet.', padLeft, padTop + 16)
      return
    }

    const plotW = Math.max(1, w - padLeft - padRight)
    const plotH = Math.max(1, h - padTop - padBottom)
    const cellW = plotW / cols.length
    const cellH = plotH / rowCount

    // Cells. Row 0 (lowest bucket) drawn at the BOTTOM.
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]
      for (let rIdx = 0; rIdx < rowCount; rIdx++) {
        const count = col.counts[rIdx] ?? 0
        if (count <= 0) continue
        ctx.fillStyle = colorFor(count, maxC)
        const x = padLeft + c * cellW
        const y = padTop + (rowCount - 1 - rIdx) * cellH
        ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH))
      }
    }

    // Y axis labels (a few bucket boundaries).
    ctx.fillStyle = '#666'
    ctx.font = '10px sans-serif'
    ctx.textBaseline = 'middle'
    const yTicks = Math.min(rowCount, 6)
    for (let i = 0; i < yTicks; i++) {
      const rIdx = Math.round((i / Math.max(1, yTicks - 1)) * (rowCount - 1))
      const y = padTop + (rowCount - 1 - rIdx) * cellH + cellH / 2
      const lbl = rowLabels[rIdx] ?? ''
      ctx.fillText(lbl.length > 11 ? lbl.slice(0, 10) + '…' : lbl, 4, y)
    }

    // X axis labels (first / middle / last timestamps).
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    const xTicks = Math.min(cols.length, 4)
    for (let i = 0; i < xTicks; i++) {
      const cIdx = Math.round((i / Math.max(1, xTicks - 1)) * (cols.length - 1))
      const x = padLeft + cIdx * cellW + cellW / 2
      const label = new Date(cols[cIdx].t).toLocaleTimeString()
      ctx.fillText(label, x, padTop + plotH + 4)
    }
    ctx.textAlign = 'start'
  }

  onMount(() => {
    mounted = true
    if (typeof ResizeObserver !== 'undefined' && canvasWrapEl) {
      const ro = new ResizeObserver((entries) => {
        const cw = entries[0]?.contentRect.width
        if (cw && cw > 0) canvasWidth = cw
      })
      ro.observe(canvasWrapEl)
      return () => ro.disconnect()
    }
  })

  // Redraw into the existing canvas on data/size/view change — never remount.
  $effect(() => {
    // Touch deps.
    void heat
    void canvasWidth
    void height
    if (!mounted) return
    if (view !== 'heatmap') return
    if (!canvasEl) return
    drawHeatmap()
  })
</script>

<div class="hist-views">
  <div class="view-toggle" role="group" aria-label="Histogram view">
    <button
      type="button"
      class="seg"
      class:active={view === 'distribution'}
      aria-pressed={view === 'distribution'}
      onclick={() => (view = 'distribution')}>Distribution</button
    >
    <button
      type="button"
      class="seg"
      class:active={view === 'heatmap'}
      aria-pressed={view === 'heatmap'}
      onclick={() => (view = 'heatmap')}>Heatmap</button
    >
  </div>

  {#if view === 'distribution'}
    {#if !latest || distBuckets.length === 0}
      <div class="empty-inline">No histogram data yet.</div>
    {:else}
      <div class="dist-meta">
        Latest point at {latestTimeLabel}
        {#if 'count' in latest}· count {latest.count}{/if}
        {#if 'sum' in latest && typeof latest.sum === 'number'}· sum {latest.sum}{/if}
      </div>
      <div class="bars" style={`height:${height}px`}>
        {#each distBuckets as b (b.label)}
          <div class="bar-row">
            <span class="bar-label" title={b.label}>{b.label}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                style={`width:${maxCount > 0 ? (b.count / maxCount) * 100 : 0}%`}
              ></div>
            </div>
            <span class="bar-count">{b.count}</span>
          </div>
        {/each}
      </div>
      {#if unit}
        <div class="axis-note">values in <code>{unit}</code></div>
      {/if}
    {/if}
  {:else}
    <div class="canvas-wrap" bind:this={canvasWrapEl}>
      <canvas bind:this={canvasEl} aria-label="Histogram heatmap over time"
      ></canvas>
    </div>
    <div class="axis-note">x = time · y = bucket · colour = count (log)</div>
  {/if}
</div>

<style>
  .hist-views {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .view-toggle {
    display: inline-flex;
    align-self: flex-start;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .seg {
    padding: 0.35rem 0.85rem;
    background: var(--bg-surface);
    border: none;
    border-right: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .seg:last-child {
    border-right: none;
  }

  .seg.active {
    background: var(--accent);
    color: #fff;
  }

  .dist-meta {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 130px 1fr 56px;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .bar-label {
    font-family: monospace;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
  }

  .bar-track {
    background: var(--bg-muted);
    border-radius: 3px;
    height: 14px;
    overflow: hidden;
  }

  .bar-fill {
    background: var(--accent);
    height: 100%;
    min-width: 0;
    transition: width 0.15s ease;
  }

  .bar-count {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--text-primary);
  }

  .canvas-wrap {
    width: 100%;
  }

  .canvas-wrap canvas {
    display: block;
    width: 100%;
  }

  .axis-note {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .axis-note code {
    font-family: monospace;
  }

  .empty-inline {
    font-size: 0.8125rem;
    color: var(--text-muted);
    padding: 1rem 0;
    text-align: center;
  }
</style>
