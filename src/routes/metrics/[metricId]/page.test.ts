// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/svelte'

const { mockGoto } = vi.hoisted(() => ({ mockGoto: vi.fn() }))

vi.mock('$app/navigation', () => ({ goto: mockGoto }))

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')
  return {
    page: readable({
      params: { metricId: 'svc metric.name' },
      url: new URL('http://localhost/metrics/svc%20metric.name'),
    }),
  }
})

// Mock UplotChart so jsdom never touches uPlot/canvas. The mock surfaces the
// series labels + the last-point value of each plotted line as text so tests can
// assert what was plotted.
vi.mock('$lib/components/UplotChart.svelte', async () => {
  const Comp = (await import('./__mocks__/UplotChartMock.svelte')).default
  return { default: Comp }
})

// MetricDetail snapshots keyed by what each test fetches.
function sumDetail() {
  return {
    id: 'svc metric.name',
    name: 'jobs.processed',
    description: '',
    unit: '1',
    type: 'sum',
    temporality: 'cumulative',
    isMonotonic: true,
    serviceName: 'svc',
    lastUpdated: 1715803200000,
    series: [
      {
        seriesId: 'a',
        attributes: { route: '/api/a' },
        points: [
          { t: 1000, v: 10 },
          { t: 2000, v: 20, rate: 10 },
          { t: 3000, v: 50, rate: 30 },
        ],
      },
      {
        seriesId: 'b',
        attributes: { route: '/web/b' },
        points: [
          { t: 1000, v: 100 },
          { t: 2000, v: 110, rate: 10 },
        ],
      },
    ],
  }
}

function summaryDetail() {
  return {
    id: 'svc metric.name',
    name: 'rpc.duration',
    description: '',
    unit: 'ms',
    type: 'summary',
    serviceName: 'svc',
    lastUpdated: 1715803200000,
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
        ],
      },
    ],
  }
}

function histogramDetail() {
  return {
    id: 'svc metric.name',
    name: 'http.duration',
    description: '',
    unit: 'ms',
    type: 'histogram',
    temporality: 'cumulative',
    serviceName: 'svc',
    lastUpdated: 1715803200000,
    series: [
      {
        seriesId: 'h',
        attributes: {},
        points: [
          {
            t: 1000,
            count: 6,
            sum: 42,
            bucketCounts: [1, 2, 3],
            explicitBounds: [5, 10],
          },
        ],
      },
    ],
  }
}

function stubFetchOnce(detail: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => detail }),
  )
}

import MetricDetailPage from './+page.svelte'

describe('metrics/[metricId] page', () => {
  beforeEach(() => {
    mockGoto.mockReset()
    // No EventSource in jsdom -> the page relies on the initial fetch only.
    vi.stubGlobal('EventSource', undefined as unknown as typeof EventSource)
  })

  it('defaults a monotonic cumulative sum to rate, and toggles to raw', async () => {
    stubFetchOnce(sumDetail())
    render(MetricDetailPage)

    await screen.findByText('jobs.processed')

    const chart = await screen.findByTestId('uplot-mock')
    // Rate mode: series "a" has rates [10, 30] -> last plotted value 30.
    expect(chart).toHaveTextContent('route=/api/a:30')

    // Toggle to raw -> series "a" last raw value 50.
    await fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(await screen.findByTestId('uplot-mock')).toHaveTextContent(
      'route=/api/a:50',
    )
  })

  it('series filter hides a series and updates the N of M note', async () => {
    stubFetchOnce(sumDetail())
    render(MetricDetailPage)
    await screen.findByText('jobs.processed')

    const note = screen.getByTestId('series-note')
    expect(note).toHaveTextContent('showing 2 of 2 series')

    const filter = screen.getByLabelText('Filter series by attribute')
    await fireEvent.input(filter, { target: { value: '/api' } })

    expect(screen.getByTestId('series-note')).toHaveTextContent(
      'showing 1 of 1 series',
    )
    const chart = screen.getByTestId('uplot-mock')
    expect(chart).toHaveTextContent('route=/api/a')
    expect(chart).not.toHaveTextContent('route=/web/b')
  })

  it('renders one line per quantile for a summary', async () => {
    stubFetchOnce(summaryDetail())
    render(MetricDetailPage)
    await screen.findByText('rpc.duration')

    const chart = await screen.findByTestId('uplot-mock')
    expect(chart).toHaveTextContent('p50:10')
    expect(chart).toHaveTextContent('p90:20')
    expect(chart).toHaveTextContent('p99:30')
  })

  it('renders histogram distribution bars from the latest point', async () => {
    stubFetchOnce(histogramDetail())
    render(MetricDetailPage)
    await screen.findByText('http.duration')

    // Distribution view is the default. Three buckets -> three rows.
    expect(await screen.findByText('-∞…5')).toBeInTheDocument()
    expect(screen.getByText('5…10')).toBeInTheDocument()
    expect(screen.getByText('10…∞')).toBeInTheDocument()

    // Switch to heatmap view (canvas) without crashing.
    await fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }))
    expect(
      screen.getByLabelText('Histogram heatmap over time'),
    ).toBeInTheDocument()
  })
})
