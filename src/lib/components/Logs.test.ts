// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte'
import Logs from './Logs.svelte'

class MockEventSource {
  static instances: MockEventSource[] = []

  listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(_url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  emit(type: string, data: string) {
    const event = { data } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  close() {}
}

// Mock the trace store
vi.mock('$lib/stores/traces.svelte', () => ({
  traceStore: {
    maxLogs: 1000,
    persistence: {
      mode: 'memory',
      enabled: false,
      backend: null,
      path: null,
      flushMs: null,
      lastRestoreAt: null,
      restoredTraceCount: 0,
      pendingFlushCount: 0,
    },
  },
}))

// Mock updateCheck so VersionInfo doesn't consume the fetch mock
vi.mock('$lib/utils/updateCheck', () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  dismissUpdate: vi.fn(),
}))

const sampleLogs = [
  {
    id: 'log-1',
    traceId: 'trace-1',
    spanId: 'span-1',
    timeUnixNano: '1715803200000000000',
    observedTimeUnixNano: '1715803200000000000',
    severityNumber: 17,
    severityText: 'ERROR',
    body: 'checkout failed',
    serviceName: 'checkout-service',
  },
  {
    id: 'log-2',
    traceId: null,
    spanId: null,
    timeUnixNano: '1715803201000000000',
    observedTimeUnixNano: '1715803201000000000',
    severityNumber: 9,
    severityText: 'INFO',
    body: { message: 'background job tick' },
    serviceName: 'worker-service',
  },
]

describe('Logs', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as never)
  })

  it('loads and renders global logs including unlinked logs', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/logs?limit=5000')
    })

    expect(await screen.findByText('checkout failed')).toBeInTheDocument()
    expect(screen.getByText('worker-service')).toBeInTheDocument()
    expect(screen.getByText('Unlinked')).toBeInTheDocument()
  })

  it('ignores the initial logs-count stream event after mount', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    MockEventSource.instances[0]?.emit('logs-count', '2')

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deletes selected logs', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleLogs,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          deletedCount: 1,
          mode: 'selected',
        }),
      } as Response)

    const { component } = render(Logs)

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Select log log-1',
    })

    await fireEvent.click(checkbox)
    await component.triggerDeleteSelected()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/logs',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logIds: ['log-1'] }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('checkout failed')).not.toBeInTheDocument()
    })
  })

  it('clears filters from filtered empty state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    const searchInput = await screen.findByLabelText('Search logs')
    await fireEvent.input(searchInput, { target: { value: 'no-match' } })

    expect(
      await screen.findByText('No logs match the current filters.'),
    ).toBeInTheDocument()

    const emptyState = screen
      .getByText('No logs match the current filters.')
      .closest('.empty')
    expect(emptyState).not.toBeNull()

    const clearButton = within(emptyState as HTMLElement).getByRole('button', {
      name: 'Clear Filters',
    })
    await fireEvent.click(clearButton)

    expect(await screen.findByText('checkout failed')).toBeInTheDocument()
  })

  it('restores logs filters from URL query params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    const originalUrl = window.location.href
    window.history.replaceState(
      window.history.state,
      '',
      '/?tab=logs&search=worker&severity=info',
    )

    render(Logs)

    expect(await screen.findByText('worker-service')).toBeInTheDocument()
    expect(screen.queryByText('checkout-service')).not.toBeInTheDocument()

    const searchInput = screen.getByLabelText('Search logs') as HTMLInputElement
    expect(searchInput.value).toBe('worker')

    const severitySelect = screen.getByLabelText(
      'Severity',
    ) as HTMLSelectElement
    expect(severitySelect.value).toBe('info')

    window.history.replaceState(window.history.state, '', originalUrl)
  })

  it('renders span links to trace details with spanId query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    const spanLink = await screen.findByRole('link', { name: 'span-1' })
    expect(spanLink).toHaveAttribute('href', '/traces/trace-1?spanId=span-1')
  })

  it('shows logs retention footer', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    expect(await screen.findByText('checkout failed')).toBeInTheDocument()
    const retentionNotice = document.querySelector('.retention-notice')
    expect(retentionNotice).not.toBeNull()
    expect(retentionNotice).toHaveTextContent('Keeping last 1000 logs')
    expect(retentionNotice).toHaveTextContent('in memory only')
  })
})
