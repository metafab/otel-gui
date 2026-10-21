import { describe, expect, it } from 'vitest'
import {
  matchesMetricTypeFilter,
  metricTypePresentation,
} from './metricPresentation.js'

describe(metricTypePresentation, () => {
  it('presents monotonic sums as Counters', () => {
    expect(metricTypePresentation({ type: 'sum', isMonotonic: true })).toEqual({
      label: 'Counter',
      badgeType: 'counter',
    })
  })

  it('presents non-monotonic sums as UpDownCounters', () => {
    expect(metricTypePresentation({ type: 'sum', isMonotonic: false })).toEqual(
      {
        label: 'UpDownCounter',
        badgeType: 'updowncounter',
      },
    )
  })

  it('leaves sums without instrument metadata labelled as Sum', () => {
    expect(metricTypePresentation({ type: 'sum' }).label).toBe('Sum')
  })
})

describe(matchesMetricTypeFilter, () => {
  const counter = { type: 'sum' as const, isMonotonic: true }
  const upDownCounter = { type: 'sum' as const, isMonotonic: false }

  it('filters Counter and UpDownCounter separately while retaining all-sum filtering', () => {
    expect(matchesMetricTypeFilter(counter, 'counter')).toBe(true)
    expect(matchesMetricTypeFilter(upDownCounter, 'counter')).toBe(false)
    expect(matchesMetricTypeFilter(upDownCounter, 'updowncounter')).toBe(true)
    expect(matchesMetricTypeFilter(counter, 'updowncounter')).toBe(false)
    expect(matchesMetricTypeFilter(counter, 'sum')).toBe(true)
    expect(matchesMetricTypeFilter(upDownCounter, 'sum')).toBe(true)
  })
})
