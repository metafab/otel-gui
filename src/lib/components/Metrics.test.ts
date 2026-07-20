// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte'
import { goto, replaceState } from '$app/navigation'
import Metrics from './Metrics.svelte'

const sseState = vi.hoisted(() => ({
  handlers: null as Record<string, (event: MessageEvent) => void> | null,
}))

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  replaceState: vi.fn(),
}))

vi.mock('$lib/stores/sseClient', () => ({
  onSSEEvents: (handlers: Record<string, (event: MessageEvent) => void>) => {
    sseState.handlers = handlers
    return () => {
      sseState.handlers = null
    }
  },
}))

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
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.mocked(goto).mockReset()
    vi.mocked(replaceState).mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', class MockEventSource {} as never)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    sseState.handlers = null
    // Reset URL params between tests — the component seeds its filters from the
    // URL on init, and a prior test may have written ?type=… / ?search=… there.
    window.history.replaceState(window.history.state, '', '/?tab=metrics')
  })

  it('shows loading before the initial metrics fetch resolves', async () => {
    let resolveFetch!: (value: Response) => void
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })

    fetchMock.mockReturnValueOnce(pendingFetch)

    render(Metrics)

    expect(screen.getByText('Loading metrics...')).toBeInTheDocument()
    expect(
      screen.queryByText('No metrics received yet.'),
    ).not.toBeInTheDocument()

    resolveFetch({
      ok: true,
      json: async () => [],
    } as Response)

    expect(
      await screen.findByText('No metrics received yet.'),
    ).toBeInTheDocument()
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
    component.triggerDeleteSelected()

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

  it('shows an error banner when deleting selected metrics fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleMetrics,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      } as Response)

    const { component } = render(Metrics)

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Select metric http.server.duration',
    })
    await fireEvent.click(checkbox)

    component.triggerDeleteSelected()

    expect(
      await screen.findByText(
        'Failed to delete selected metrics: Internal Server Error',
      ),
    ).toBeInTheDocument()
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

  it('restores metrics filters from URL query params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    const originalUrl = window.location.href
    window.history.replaceState(
      window.history.state,
      '',
      '/?tab=metrics&search=jobs&service=worker-service&type=sum&sort=name&order=asc',
    )

    render(Metrics)

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('jobs.processed')).toBeInTheDocument()
    expect(
      within(table).queryByText('http.server.duration'),
    ).not.toBeInTheDocument()

    const searchInput = screen.getByLabelText(
      'Search metrics',
    ) as HTMLInputElement
    expect(searchInput.value).toBe('jobs')

    const servicePicker = screen.getByLabelText('Service')
    expect(servicePicker).toHaveTextContent('worker-service')

    const typePicker = screen.getByLabelText('Metric type')
    expect(typePicker).toHaveTextContent('Sum')

    window.history.replaceState(window.history.state, '', originalUrl)
  })

  it('sorts metrics by header clicks and updates URL params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await screen.findByRole('table')

    const getRowIds = () =>
      screen
        .getAllByTestId('metric-row')
        .map((row) => row.getAttribute('data-metric-id'))

    // Default sort is updated desc, so newer worker metric is first.
    expect(getRowIds()[0]).toBe('worker-service jobs.processed')

    await fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }))

    expect(getRowIds()[0]).toBe('checkout-service http.server.duration')
    expect(vi.mocked(replaceState)).toHaveBeenCalled()
  })

  it('navigates to metric detail when row is activated with Enter and Space', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    const rows = await screen.findAllByTestId('metric-row')
    const firstRow = rows[0] as HTMLElement

    await fireEvent.keyDown(firstRow, { key: 'Enter' })
    await fireEvent.keyDown(firstRow, { key: ' ' })

    const expectedHref =
      '/metrics/worker-service%20jobs.processed?returnTo=%2F%3Ftab%3Dmetrics'

    expect(vi.mocked(goto)).toHaveBeenNthCalledWith(1, expectedHref)
    expect(vi.mocked(goto)).toHaveBeenNthCalledWith(2, expectedHref)
  })

  it('filters by search + service + type together', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    const searchInput = await screen.findByLabelText('Search metrics')
    await fireEvent.input(searchInput, { target: { value: 'jobs' } })

    const servicePicker = screen.getByLabelText('Service')
    await fireEvent.click(servicePicker)
    await fireEvent.click(
      screen.getByRole('button', { name: 'worker-service' }),
    )

    const typePicker = screen.getByLabelText('Metric type')
    await fireEvent.click(typePicker)
    await fireEvent.click(screen.getByRole('button', { name: 'Sum' }))

    expect(await screen.findByText('jobs.processed')).toBeInTheDocument()
    expect(screen.queryByText('http.server.duration')).not.toBeInTheDocument()
  })

  it('applies incoming metrics-snapshot stream events', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response)

    render(Metrics)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    sseState.handlers?.['metrics-snapshot']?.({
      data: JSON.stringify({ metrics: sampleMetrics }),
    } as MessageEvent)

    expect(await screen.findByText('http.server.duration')).toBeInTheDocument()
    expect(await screen.findByText('jobs.processed')).toBeInTheDocument()
  })

  it('upserts incoming metrics-append stream events', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleMetrics,
    } as Response)

    render(Metrics)

    await screen.findByText('http.server.duration')

    sseState.handlers?.['metrics-append']?.({
      data: JSON.stringify({
        metrics: [
          {
            id: 'checkout-service http.server.duration',
            name: 'http.server.duration',
            type: 'gauge',
            unit: 'ms',
            serviceName: 'checkout-service',
            seriesCount: 5,
            lastUpdated: 1715803203000,
            sparkline: [1, 2, 3],
          },
          {
            id: 'payments-service http.client.duration',
            name: 'http.client.duration',
            type: 'histogram',
            unit: 'ms',
            serviceName: 'payments-service',
            seriesCount: 2,
            lastUpdated: 1715803204000,
            sparkline: [4, 8, 6],
          },
        ],
      }),
    } as MessageEvent)

    await screen.findByText('http.client.duration')

    const renderedIds = screen
      .getAllByTestId('metric-row')
      .map((row) => row.getAttribute('data-metric-id'))

    expect(
      renderedIds.filter(
        (id) => id === 'checkout-service http.server.duration',
      ),
    ).toHaveLength(1)
    expect(renderedIds).toContain('payments-service http.client.duration')
  })
})
