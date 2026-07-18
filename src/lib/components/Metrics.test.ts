// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte'
import Metrics from './Metrics.svelte'

// Mock the metric store (only maxMetrics is read by the component).
vi.mock('$lib/stores/metrics.svelte', () => ({
  metricStore: {
    maxMetrics: 1000,
  },
}))

// Mock updateCheck so VersionInfo doesn't consume the fetch mock.
vi.mock('$lib/utils/updateCheck', () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  dismissUpdate: vi.fn(),
}))

const sampleMetrics = [
  {
    id: 'checkout-service http.server.duration',
    name: 'http.server.duration',
    type: 'gauge',
    unit: 'ms',
    serviceName: 'checkout-service',
    seriesCount: 3,
    lastUpdated: 1715803200000,
    sparkline: [1, 4, 2, 8, 5],
  },
  {
    id: 'worker-service jobs.processed',
    name: 'jobs.processed',
    type: 'sum',
    unit: '1',
    serviceName: 'worker-service',
    seriesCount: 1,
    lastUpdated: 1715803201000,
    sparkline: [10, 20, 30],
  },
]

describe('Metrics', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    // Reset URL params between tests — the component seeds its filters from the
    // URL on init, and a prior test may have written ?type=… / ?search=… there.
    window.history.replaceState(window.history.state, '', '/?tab=metrics')
  })

  it('loads and renders metric rows from a snapshot', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/metrics?limit=5000')
    })

    expect(await screen.findByText('http.server.duration')).toBeInTheDocument()
    expect(screen.getByText('jobs.processed')).toBeInTheDocument()
    // Service names also appear as options in the Service filter dropdown, so
    // scope these assertions to the table body.
    const table = screen.getByRole('table')
    expect(within(table).getByText('checkout-service')).toBeInTheDocument()
    expect(within(table).getByText('worker-service')).toBeInTheDocument()
  })

  it('filters metrics by service', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await screen.findByText('http.server.duration')

    const servicePicker = screen.getByLabelText('Service')
    await fireEvent.click(servicePicker)
    await fireEvent.click(
      screen.getByRole('button', { name: 'worker-service' }),
    )

    expect(screen.queryByText('http.server.duration')).not.toBeInTheDocument()
    expect(screen.getByText('jobs.processed')).toBeInTheDocument()
  })

  it('filters metrics by type', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await screen.findByText('http.server.duration')

    const typePicker = screen.getByLabelText('Metric type')
    await fireEvent.click(typePicker)
    await fireEvent.click(screen.getByRole('button', { name: 'Sum' }))

    expect(screen.queryByText('http.server.duration')).not.toBeInTheDocument()
    expect(screen.getByText('jobs.processed')).toBeInTheDocument()
  })

  it('deletes selected metrics with the ids payload', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleMetrics,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          deletedCount: 1,
          mode: 'selected',
        }),
      } as Response)

    const { component } = render(Metrics)

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Select metric http.server.duration',
    })

    await fireEvent.click(checkbox)
    await component.triggerDeleteSelected()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/metrics',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: ['checkout-service http.server.duration'],
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('http.server.duration')).not.toBeInTheDocument()
    })
  })

  it('clears filters from filtered empty state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    const searchInput = await screen.findByLabelText('Search metrics')
    await fireEvent.input(searchInput, { target: { value: 'no-match' } })

    expect(
      await screen.findByText('No metrics match the current filters.'),
    ).toBeInTheDocument()

    const emptyState = screen
      .getByText('No metrics match the current filters.')
      .closest('.empty')
    expect(emptyState).not.toBeNull()

    const clearButton = within(emptyState as HTMLElement).getByRole('button', {
      name: 'Clear Filters',
    })
    await fireEvent.click(clearButton)

    expect(await screen.findByText('http.server.duration')).toBeInTheDocument()
  })

  it('shows metrics retention footer', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await screen.findByText('http.server.duration')
    const retentionNotice = document.querySelector('.retention-notice')
    expect(retentionNotice).not.toBeNull()
    expect(retentionNotice).toHaveTextContent('Keeping last 1000 metric series')
    expect(retentionNotice).toHaveTextContent('in memory only')
  })
})
