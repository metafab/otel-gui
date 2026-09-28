// Pure helpers for histogram + exp_histogram rendering (distribution bars and
// the time heatmap). No DOM / canvas here so the bucketing logic is unit-tested
// directly; HistogramHeatmap.svelte does the drawing.
import { expoBoundsForBucket } from '@otel-gui/core'
import type {
  HistogramPoint,
  ExpHistogramPoint,
  MetricWirePoint,
} from '$lib/types'

// One bucket of a distribution: a value range [lower, upper) and its count.
// `lower`/`upper` may be -Infinity / +Infinity for the implicit overflow edges.
export interface DistBucket {
  lower: number
  upper: number
  count: number
  label: string
}

export function isHistogramPoint(p: MetricWirePoint): p is HistogramPoint {
  return (
    typeof p === 'object' &&
    p !== null &&
    'bucketCounts' in p &&
    'explicitBounds' in p
  )
}

export function isExpHistogramPoint(
  p: MetricWirePoint,
): p is ExpHistogramPoint {
  return typeof p === 'object' && p !== null && 'scale' in p && 'positive' in p
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  if (Number.isInteger(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(2)
  return Number(n.toFixed(4)).toString()
}

// Explicit-bucket histogram → distribution buckets.
// bucketCounts.length === explicitBounds.length + 1; bucket i covers
// (bounds[i-1], bounds[i]], with the final bucket being the +∞ overflow.
export function explicitBuckets(p: HistogramPoint): DistBucket[] {
  const { bucketCounts, explicitBounds } = p
  const buckets: DistBucket[] = []
  for (let i = 0; i < bucketCounts.length; i++) {
    const lower = i === 0 ? -Infinity : explicitBounds[i - 1]
    const upper = i < explicitBounds.length ? explicitBounds[i] : Infinity
    buckets.push({
      lower,
      upper,
      count: bucketCounts[i] ?? 0,
      label: `${fmt(lower)}…${fmt(upper)}`,
    })
  }
  return buckets
}

// Exponential histogram → distribution buckets, lowest value first.
// Negative buckets map to negated magnitude bounds, then the zero bucket, then
// the positive buckets via expoBoundsForBucket(scale, offset + i).
export function expoBuckets(p: ExpHistogramPoint): DistBucket[] {
  const buckets: DistBucket[] = []

  // Negative buckets: descending magnitude → most-negative value first.
  const neg = p.negative
  if (neg && neg.bucketCounts.length > 0) {
    const items: DistBucket[] = []
    for (let i = 0; i < neg.bucketCounts.length; i++) {
      const { lower, upper } = expoBoundsForBucket(p.scale, neg.offset + i)
      // magnitude (lower, upper] -> value [-upper, -lower)
      items.push({
        lower: -upper,
        upper: -lower,
        count: neg.bucketCounts[i] ?? 0,
        label: `${fmt(-upper)}…${fmt(-lower)}`,
      })
    }
    // most-negative (largest magnitude) first
    items.sort((a, b) => a.lower - b.lower)
    buckets.push(...items)
  }

  // Zero bucket.
  if (p.zeroCount > 0) {
    buckets.push({ lower: 0, upper: 0, count: p.zeroCount, label: '0' })
  }

  // Positive buckets: ascending.
  const pos = p.positive
  if (pos && pos.bucketCounts.length > 0) {
    for (let i = 0; i < pos.bucketCounts.length; i++) {
      const { lower, upper } = expoBoundsForBucket(p.scale, pos.offset + i)
      buckets.push({
        lower,
        upper,
        count: pos.bucketCounts[i] ?? 0,
        label: `${fmt(lower)}…${fmt(upper)}`,
      })
    }
  }

  return buckets
}

export function bucketsForPoint(p: MetricWirePoint): DistBucket[] {
  if (isExpHistogramPoint(p)) return expoBuckets(p)
  if (isHistogramPoint(p)) return explicitBuckets(p)
  return []
}

// Latest (max-t) histogram point in a series.
export function latestHistPoint(
  points: MetricWirePoint[],
): MetricWirePoint | null {
  let latest: MetricWirePoint | null = null
  let latestT = -Infinity
  for (const p of points) {
    if ((isHistogramPoint(p) || isExpHistogramPoint(p)) && p.t >= latestT) {
      latestT = p.t
      latest = p
    }
  }
  return latest
}
