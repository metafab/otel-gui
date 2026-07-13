import { describe, expect, it } from 'vitest'
import { expoBoundsForBucket } from '@otel-gui/core'
import {
  explicitBuckets,
  expoBuckets,
  bucketsForPoint,
  latestHistPoint,
} from './histogram'
import type { HistogramPoint, ExpHistogramPoint } from '$lib/types'

describe('explicitBuckets', () => {
  it('maps bucketCounts onto bounds with -inf/+inf overflow edges', () => {
    const p: HistogramPoint = {
      t: 1000,
      count: 6,
      sum: 12,
      bucketCounts: [1, 2, 3], // length = bounds.length + 1
      explicitBounds: [5, 10],
    }
    const b = explicitBuckets(p)
    expect(b).toHaveLength(3)
    expect(b[0].lower).toBe(-Infinity)
    expect(b[0].upper).toBe(5)
    expect(b[0].count).toBe(1)
    expect(b[1].lower).toBe(5)
    expect(b[1].upper).toBe(10)
    expect(b[2].lower).toBe(10)
    expect(b[2].upper).toBe(Infinity)
    expect(b[2].count).toBe(3)
  })
})

describe('expoBuckets', () => {
  it('uses expoBoundsForBucket for positive buckets', () => {
    const p: ExpHistogramPoint = {
      t: 1000,
      count: 3,
      scale: 0,
      zeroCount: 0,
      positive: { offset: 0, bucketCounts: [1, 2] },
      negative: { offset: 0, bucketCounts: [] },
    }
    const b = expoBuckets(p)
    expect(b).toHaveLength(2)
    const expected0 = expoBoundsForBucket(0, 0)
    expect(b[0].lower).toBeCloseTo(expected0.lower)
    expect(b[0].upper).toBeCloseTo(expected0.upper)
    expect(b[0].count).toBe(1)
  })

  it('includes a zero bucket and negative buckets ordered most-negative first', () => {
    const p: ExpHistogramPoint = {
      t: 1000,
      count: 5,
      scale: 0,
      zeroCount: 2,
      positive: { offset: 0, bucketCounts: [1] },
      negative: { offset: 0, bucketCounts: [1, 1] },
    }
    const b = expoBuckets(p)
    // negatives first (ascending value => most negative first), then zero, then positive
    expect(b[0].upper).toBeLessThan(0)
    const zero = b.find((x) => x.lower === 0 && x.upper === 0)
    expect(zero?.count).toBe(2)
    // negatives sorted so first is the most negative
    expect(b[0].lower).toBeLessThanOrEqual(b[1].lower)
  })
})

describe('bucketsForPoint + latestHistPoint', () => {
  it('dispatches on point shape', () => {
    const hist: HistogramPoint = {
      t: 1,
      count: 1,
      bucketCounts: [1],
      explicitBounds: [],
    }
    expect(bucketsForPoint(hist)).toHaveLength(1)
  })

  it('picks the latest histogram point by t', () => {
    const pts: HistogramPoint[] = [
      { t: 1000, count: 1, bucketCounts: [1], explicitBounds: [] },
      { t: 3000, count: 3, bucketCounts: [3], explicitBounds: [] },
      { t: 2000, count: 2, bucketCounts: [2], explicitBounds: [] },
    ]
    const latest = latestHistPoint(pts)
    expect(latest?.t).toBe(3000)
  })
})
