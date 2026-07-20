// Pure helpers for the metric detail page line charts (gauge / sum / summary).
//
// All uPlot-facing data shaping lives here (no DOM, no uPlot import) so it can
// be unit-tested directly and the Svelte component stays a thin renderer:
//   - scalar series (gauge/sum) with a raw↔rate toggle (§4)
//   - summary metrics expanded to one line per quantile (§3)
//   - attribute-filtering + top-N capping of plotted series (§5)
import type {
  MetricDetail,
  MetricScalarWirePoint,
  SummaryPoint,
} from '$lib/types'

export type ValueMode = 'raw' | 'rate'

// A stable palette so each plotted line keeps its colour across live updates.
export const METRIC_PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
]

// Cap on simultaneously-plotted lines. High-cardinality metrics keep the top-N
// by latest value; the UI surfaces a "showing N of M" note (never silent).
export const DEFAULT_SERIES_CAP = 20

// One logical line to plot: a label, the (t,v) samples, and the originating
// series id so the legend checkbox state maps back to a series.
export interface ChartLine {
  seriesId: string
  label: string
  // present for summary lines (quantile fraction 0..1); undefined otherwise
  quantile?: number
  points: { t: number; v: number }[]
}

export interface UplotSeriesSpec {
  label: string
  stroke: string
  width: number
  spanGaps: boolean
}

export interface ChartBuild {
  // [xs, ys1, ys2, …] with xs in UNIX SECONDS for uPlot's time scale.
  data: (number | null)[][]
  series: UplotSeriesSpec[]
}

export function seriesLabel(
  s: { attributes: Record<string, unknown> },
  metricName: string,
): string {
  const keys = Object.keys(s.attributes)
  if (keys.length === 0) return metricName
  return keys
    .sort()
    .map((k) => `${k}=${String(s.attributes[k])}`)
    .join(', ')
}

// The default value mode per §4: rate for monotonic cumulative sums (what makes
// counters readable), raw otherwise.
export function defaultValueMode(metric: {
  type: string
  temporality?: string
  isMonotonic?: boolean
}): ValueMode {
  if (
    metric.type === 'sum' &&
    metric.isMonotonic === true &&
    metric.temporality === 'cumulative'
  ) {
    return 'rate'
  }
  return 'raw'
}

function isScalarPoint(p: unknown): p is MetricScalarWirePoint {
  return typeof p === 'object' && p !== null && 'v' in p
}

function isSummaryPoint(p: unknown): p is SummaryPoint {
  return (
    typeof p === 'object' &&
    p !== null &&
    'quantileValues' in p &&
    Array.isArray((p as SummaryPoint).quantileValues)
  )
}

// Expand a metric's series into the flat set of plottable lines.
//   gauge/sum  -> one line per series (rate mode skips points without `rate`)
//   summary    -> one line per (series × quantile)
export function buildLines(
  metric: Pick<MetricDetail, 'name' | 'type' | 'series'>,
  valueMode: ValueMode,
): ChartLine[] {
  if (metric.type === 'summary') {
    return buildSummaryLines(metric)
  }

  const lines: ChartLine[] = []
  for (const s of metric.series) {
    const points: { t: number; v: number }[] = []
    for (const p of s.points) {
      if (!isScalarPoint(p)) continue
      if (valueMode === 'rate') {
        if (typeof p.rate === 'number') points.push({ t: p.t, v: p.rate })
      } else {
        points.push({ t: p.t, v: p.v })
      }
    }
    lines.push({
      seriesId: s.seriesId,
      label: seriesLabel(s, metric.name),
      points,
    })
  }
  return lines
}

function formatQuantile(q: number): string {
  // 0.5 -> p50, 0.99 -> p99, 0.999 -> p99.9
  const pct = q * 100
  const rounded =
    Math.abs(pct - Math.round(pct)) < 1e-9
      ? String(Math.round(pct))
      : String(Number(pct.toFixed(3)))
  return `p${rounded}`
}

// Summary: render one line per quantile. If the metric has a single series we
// label lines just by quantile (p50/p90/p99); with multiple series we qualify
// with the series label so lines stay distinguishable.
function buildSummaryLines(
  metric: Pick<MetricDetail, 'name' | 'type' | 'series'>,
): ChartLine[] {
  const multiSeries = metric.series.length > 1
  const lines: ChartLine[] = []

  for (const s of metric.series) {
    // Collect the quantile fractions present anywhere in this series.
    const quantiles = new Set<number>()
    for (const p of s.points) {
      if (!isSummaryPoint(p)) continue
      for (const qv of p.quantileValues) quantiles.add(qv.quantile)
    }

    const sLabel = seriesLabel(s, metric.name)
    for (const q of Array.from(quantiles).sort((a, b) => a - b)) {
      const points: { t: number; v: number }[] = []
      for (const p of s.points) {
        if (!isSummaryPoint(p)) continue
        const qv = p.quantileValues.find((x) => x.quantile === q)
        if (qv) points.push({ t: p.t, v: qv.value })
      }
      const qLabel = formatQuantile(q)
      lines.push({
        seriesId: `${s.seriesId}::${q}`,
        label: multiSeries ? `${qLabel} · ${sLabel}` : qLabel,
        quantile: q,
        points,
      })
    }
  }

  return lines
}

// Latest (max-t) plotted value of a line, used to rank for the top-N cap.
function latestValue(line: ChartLine): number {
  let latestT = -Infinity
  let v = 0
  for (const p of line.points) {
    if (p.t >= latestT) {
      latestT = p.t
      v = p.v
    }
  }
  return v
}

export interface FilterResult {
  // lines that survive the attribute filter (pre-cap), preserving input order
  matched: ChartLine[]
  // the subset actually plotted after the top-N cap
  plotted: ChartLine[]
  cappedOut: number // matched - plotted (>0 means we hid some)
}

// Apply the attribute substring filter and the explicit hidden-set, then cap to
// the top-N by latest value. `hidden` holds seriesIds the user unchecked.
export function filterLines(
  lines: ChartLine[],
  opts: {
    attrFilter?: string
    hidden?: Set<string>
    cap?: number
  } = {},
): FilterResult {
  const attr = (opts.attrFilter ?? '').trim().toLowerCase()
  const hidden = opts.hidden ?? new Set<string>()
  const cap = opts.cap ?? DEFAULT_SERIES_CAP

  const matched = lines.filter((l) => {
    if (hidden.has(l.seriesId)) return false
    if (attr && !l.label.toLowerCase().includes(attr)) return false
    return true
  })

  let plotted = matched
  let cappedOut = 0
  if (matched.length > cap) {
    plotted = [...matched]
      .sort((a, b) => latestValue(b) - latestValue(a))
      .slice(0, cap)
    cappedOut = matched.length - plotted.length
  }

  return { matched, plotted, cappedOut }
}

// Turn the chosen lines into uPlot AlignedData on a unified, sorted x-axis.
// Timestamps are epoch-ms in the data; uPlot's time scale wants UNIX SECONDS.
export function buildAlignedData(lines: ChartLine[]): ChartBuild {
  if (lines.length === 0) {
    return { data: [[]], series: [] }
  }

  const tSet = new Set<number>()
  for (const l of lines) {
    for (const p of l.points) tSet.add(p.t)
  }
  const tsMs = Array.from(tSet).sort((a, b) => a - b)
  const xs = tsMs.map((t) => t / 1000)

  const data: (number | null)[][] = [xs]
  const series: UplotSeriesSpec[] = []

  lines.forEach((l, i) => {
    const byT = new Map<number, number>()
    for (const p of l.points) byT.set(p.t, p.v)
    data.push(tsMs.map((t) => (byT.has(t) ? byT.get(t)! : null)))
    series.push({
      label: l.label,
      stroke: METRIC_PALETTE[i % METRIC_PALETTE.length],
      width: 1.5,
      spanGaps: false,
    })
  })

  return { data, series }
}
