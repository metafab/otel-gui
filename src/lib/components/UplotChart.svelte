<script lang="ts">
  // The ONLY component that touches uPlot's imperative API.
  //
  // Flicker-free contract: the uPlot instance is constructed exactly once in
  // onMount. On data/size changes we call u.setData() / u.setSize() — we NEVER
  // re-create the instance. Re-creating on every live append is what causes the
  // chart to flash/reset zoom, so the $effect below is careful to drive the
  // existing instance instead.
  import { onMount, onDestroy, tick } from 'svelte'
  import uPlot from 'uplot'
  import { themeStore } from '$lib/stores/theme.svelte'
  import { metricTimeRange } from '$lib/utils/metricChart'
  import 'uplot/dist/uPlot.min.css'

  interface Props {
    // Aligned data: [xs, ys1, ys2, …] — xs in UNIX SECONDS (uPlot time scale).
    data: uPlot.AlignedData
    // Series definitions (excluding the implicit x-axis series at index 0).
    series: uPlot.Series[]
    height?: number
  }

  let { data, series, height = 360 }: Props = $props()

  let containerEl = $state<HTMLDivElement | null>(null)
  let chart: uPlot | null = null
  let resizeObserver: ResizeObserver | null = null
  let colorSchemeQuery: MediaQueryList | null = null

  // Canvas stroke styles need resolved colors; they cannot use CSS var() directly.
  function themeColor(token: string): string {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(token)
      .trim()
  }

  function redrawAfterThemeChange(): void {
    void tick().then(() => chart?.redraw())
  }

  function handleColorSchemeChange(): void {
    if (themeStore.current === 'system') redrawAfterThemeChange()
  }

  function yAxisSize(
    plot: uPlot,
    values: string[] | null,
    axisIdx: number,
  ): number {
    if (!values) return 50

    const axis = plot.axes[axisIdx]
    const ctx = plot.ctx
    ctx.save()
    if (axis.font) ctx.font = axis.font
    const labelWidth = values.reduce(
      (widest, value) => Math.max(widest, ctx.measureText(value).width),
      0,
    )
    ctx.restore()

    return Math.ceil(
      labelWidth / uPlot.pxRatio +
        (axis.gap ?? 0) +
        (axis.ticks?.size ?? 0) +
        8,
    )
  }

  function buildOptions(width: number): uPlot.Options {
    return {
      width,
      height,
      // Raw values, time x-axis (uPlot default time scale = unix seconds).
      scales: {
        x: {
          time: true,
          range: (plot, min, max) => metricTimeRange(min, max, plot.data[0]),
        },
      },
      series: [{}, ...series],
      legend: { show: true, live: true },
      cursor: {
        focus: { prox: 16 },
      },
      axes: [
        {
          stroke: () => themeColor('--text-secondary'),
          grid: { stroke: () => themeColor('--border-light'), width: 1 },
          ticks: { stroke: () => themeColor('--border') },
        },
        {
          stroke: () => themeColor('--text-secondary'),
          grid: { stroke: () => themeColor('--border-light'), width: 1 },
          ticks: { stroke: () => themeColor('--border') },
          size: yAxisSize,
        },
      ],
    }
  }

  onMount(() => {
    if (!containerEl) return
    const width = containerEl.clientWidth || 600
    chart = new uPlot(buildOptions(width), data, containerEl)

    // Keep the chart sized to its container without re-creating it.
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        if (!chart) return
        const w = entries[0]?.contentRect.width
        if (w && w > 0) chart.setSize({ width: w, height })
      })
      resizeObserver.observe(containerEl)
    }

    if (typeof window.matchMedia === 'function') {
      colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
      colorSchemeQuery.addEventListener('change', handleColorSchemeChange)
    }
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    colorSchemeQuery?.removeEventListener('change', handleColorSchemeChange)
    colorSchemeQuery = null
    chart?.destroy()
    chart = null
  })

  $effect(() => {
    void themeStore.current
    if (chart) redrawAfterThemeChange()
  })

  // Drive live updates into the EXISTING instance. Re-creating the chart here
  // is what would cause a flash on every SSE tick, so we never do that.
  $effect(() => {
    // Touch reactive deps so the effect re-runs on data/series/height change.
    const nextData = data
    const nextSeries = series
    void height
    if (!chart) return

    // If the series set changed (count or labels), uPlot needs its series
    // definitions rebuilt. addSeries/delSeries keeps the same instance alive.
    const liveSeriesCount = chart.series.length - 1 // minus the x series
    const labelsChanged =
      liveSeriesCount !== nextSeries.length ||
      nextSeries.some((s, i) => chart!.series[i + 1]?.label !== s.label)

    if (labelsChanged) {
      // Remove existing data series (index 1..n), then add the new ones.
      for (let i = chart.series.length - 1; i >= 1; i--) {
        chart.delSeries(i)
      }
      for (const s of nextSeries) {
        chart.addSeries(s)
      }
    }

    chart.setData(nextData)
  })
</script>

<div class="uplot-chart" bind:this={containerEl}></div>

<style>
  .uplot-chart {
    width: 100%;
  }

  /* uPlot renders into a child element; ensure it can fill the container. */
  .uplot-chart :global(.uplot) {
    width: 100%;
  }
</style>
