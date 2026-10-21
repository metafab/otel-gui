import type { MetricListItem, MetricType } from '#otel-gui/core'

export type MetricTypeFilter = 'all' | MetricType | 'counter' | 'updowncounter'

export type MetricBadgeType = MetricType | 'counter' | 'updowncounter'

export interface MetricTypePresentation {
  label: string
  badgeType: MetricBadgeType
}

export function metricTypePresentation(
  metric: Pick<MetricListItem, 'type' | 'isMonotonic'>,
): MetricTypePresentation {
  if (metric.type === 'sum') {
    if (metric.isMonotonic === true) {
      return { label: 'Counter', badgeType: 'counter' }
    }
    if (metric.isMonotonic === false) {
      return {
        label: 'UpDownCounter',
        badgeType: 'updowncounter',
      }
    }
  }

  const labels: Record<MetricType, string> = {
    gauge: 'Gauge',
    sum: 'Sum',
    histogram: 'Histogram',
    exp_histogram: 'Exp. Histogram',
    summary: 'Summary',
  }

  return {
    label: labels[metric.type],
    badgeType: metric.type,
  }
}

export function matchesMetricTypeFilter(
  metric: Pick<MetricListItem, 'type' | 'isMonotonic'>,
  filter: MetricTypeFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'counter') {
    return metric.type === 'sum' && metric.isMonotonic === true
  }
  if (filter === 'updowncounter') {
    return metric.type === 'sum' && metric.isMonotonic === false
  }
  return metric.type === filter
}
