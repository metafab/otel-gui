import { describe, expect, it } from 'vitest'
import {
  buildLines,
  filterLines,
  buildAlignedData,
  defaultValueMode,
  seriesLabel,
} from './metricChart'
import type { MetricDetail } from '$lib/types'

function sumMetric(): Pick<MetricDetail, 'name' | 'type' | 'series'> {
  return {
    name: 'jobs.processed',
    type: 'sum',
    series: [
      {
        seriesId: 'a',
        attributes: { route: '/api/a' },
        points: [
          { t: 1000, v: 10 }, // no rate (first point)
          { t: 2000, v: 20, rate: 10 },
          { t: 3000, v: 50, rate: 30 },
        ],
      },
    ],
  }
}

describe('defaultValueMode', () => {
  it('defaults to rate for monotonic cumulative sums', () => {
    expect(
      defaultValueMode({
        type: 'sum',
        isMonotonic: true,
        temporality: 'cumulative',
      }),
    ).toBe('rate')
  })

  it('defaults to raw for non-monotonic / delta sums and gauges', () => {
    expect(
      defaultValueMode({
        type: 'sum',
        isMonotonic: false,
        temporality: 'cumulative',
      }),
    ).toBe('raw')
    expect(
      defaultValueMode({
        type: 'sum',
        isMonotonic: true,
        temporality: 'delta',
      }),
    ).toBe('raw')
    expect(defaultValueMode({ type: 'gauge' })).toBe('raw')
  })
})

describe('buildLines (sum raw vs rate)', () => {
  it('raw mode plots v for every point', () => {
    const lines = buildLines(sumMetric(), 'raw')
    expect(lines).toHaveLength(1)
    expect(lines[0].points.map((p) => p.v)).toEqual([10, 20, 50])
  })

  it('rate mode plots rate and skips points without one', () => {
    const lines = buildLines(sumMetric(), 'rate')
    expect(lines[0].points.map((p) => p.v)).toEqual([10, 30])
    expect(lines[0].points.map((p) => p.t)).toEqual([2000, 3000])
  })
})

describe('buildLines (summary -> one line per quantile)', () => {
  const summary: Pick<MetricDetail, 'name' | 'type' | 'series'> = {
    name: 'rpc.duration',
    type: 'summary',
    series: [
      {
        seriesId: 's',
        attributes: {},
        points: [
          {
            t: 1000,
            count: 5,
            sum: 100,
            quantileValues: [
              { quantile: 0.5, value: 10 },
              { quantile: 0.9, value: 20 },
              { quantile: 0.99, value: 30 },
            ],
          },
          {
            t: 2000,
            count: 9,
            sum: 200,
            quantileValues: [
              { quantile: 0.5, value: 12 },
              { quantile: 0.9, value: 22 },
              { quantile: 0.99, value: 35 },
            ],
          },
        ],
      },
    ],
  }

  it('produces one line per quantile labelled pNN', () => {
    const lines = buildLines(summary, 'raw')
    expect(lines.map((l) => l.label)).toEqual(['p50', 'p90', 'p99'])
    const p99 = lines.find((l) => l.label === 'p99')!
    expect(p99.points.map((p) => p.v)).toEqual([30, 35])
  })
})

describe('filterLines (attribute filter + top-N cap)', () => {
  function manyLines(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      seriesId: `s${i}`,
      label: `route=/api/${i}`,
      points: [{ t: 1000, v: i }],
    }))
  }

  it('filters by attribute substring', () => {
    const lines = [
      { seriesId: 'a', label: 'route=/api/a', points: [{ t: 1, v: 1 }] },
      { seriesId: 'b', label: 'route=/web/b', points: [{ t: 1, v: 2 }] },
    ]
    const res = filterLines(lines, { attrFilter: '/api' })
    expect(res.matched.map((l) => l.seriesId)).toEqual(['a'])
    expect(res.cappedOut).toBe(0)
  })

  it('hides unchecked series', () => {
    const lines = [
      { seriesId: 'a', label: 'a', points: [{ t: 1, v: 1 }] },
      { seriesId: 'b', label: 'b', points: [{ t: 1, v: 2 }] },
    ]
    const res = filterLines(lines, { hidden: new Set(['a']) })
    expect(res.matched.map((l) => l.seriesId)).toEqual(['b'])
  })

  it('caps to top-N by latest value and reports cappedOut', () => {
    const res = filterLines(manyLines(25), { cap: 20 })
    expect(res.matched).toHaveLength(25)
    expect(res.plotted).toHaveLength(20)
    expect(res.cappedOut).toBe(5)
    // top-N keeps the highest latest values (24..5).
    expect(res.plotted[0].points[0].v).toBe(24)
  })
})

describe('buildAlignedData', () => {
  it('builds a unified seconds x-axis with nulls for gaps', () => {
    const build = buildAlignedData([
      { seriesId: 'a', label: 'a', points: [{ t: 1000, v: 1 }] },
      { seriesId: 'b', label: 'b', points: [{ t: 2000, v: 2 }] },
    ])
    // xs in seconds
    expect(build.data[0]).toEqual([1, 2])
    expect(build.data[1]).toEqual([1, null])
    expect(build.data[2]).toEqual([null, 2])
    expect(build.series).toHaveLength(2)
  })

  it('returns an empty shape for no lines', () => {
    const build = buildAlignedData([])
    expect(build.data).toEqual([[]])
    expect(build.series).toEqual([])
  })
})

describe('seriesLabel', () => {
  it('joins sorted attributes', () => {
    expect(seriesLabel({ attributes: { b: 2, a: 1 } }, 'm')).toBe('a=1, b=2')
  })

  it('falls back to the metric name when no attributes', () => {
    expect(seriesLabel({ attributes: {} }, 'metric.name')).toBe('metric.name')
  })
})
