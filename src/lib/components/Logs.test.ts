// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte'

const { mockGoto } = vi.hoisted(() => ({
  mockGoto: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  goto: mockGoto,
}))

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
vi.mock('#lib/stores/traces.svelte.js', () => ({
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
vi.mock('#lib/utils/updateCheck.js', () => ({
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
    attributes: { 'http.route': '/checkout' },
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
    attributes: { 'http.route': '/checkout' },
  },
]

describe(Logs, () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGoto.mockImplementation((url: URL | string) => {
      window.history.replaceState(window.history.state, '', url)
    })
    window.history.replaceState(null, '', '/')
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

    const table = await screen.findByRole('table')
    expect(
      await within(table).findByText('checkout failed'),
    ).toBeInTheDocument()
    expect(within(table).getByText('worker-service')).toBeInTheDocument()
    expect(within(table).getByText('Unlinked')).toBeInTheDocument()
  })

  it('expands a row to preview attributes without navigating', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)
    await screen.findByText('checkout failed')

    expect(screen.queryByText('http.route')).not.toBeInTheDocument()

    const [toggle] = screen.getAllByRole('button', {
      name: 'Show attributes',
    })
    await fireEvent.click(toggle)

    expect(await screen.findByText('http.route')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockGoto).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('log-row')).toHaveLength(2)

    await fireEvent.click(
      screen.getByRole('button', { name: 'Hide attributes' }),
    )
    expect(screen.queryByText('http.route')).not.toBeInTheDocument()
  })

  it('shows the attribute count and a grey pill when there are none', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          ...sampleLogs[0],
          attributes: { a: '1', b: '2', c: '3' },
        },
        { ...sampleLogs[1], attributes: {} },
      ],
    } as Response)

    render(Logs)
    await screen.findByText('checkout failed')

    expect(
      screen.getAllByRole('button', { name: 'Show attributes' }),
    ).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Show attributes' }),
    ).toHaveTextContent('3 attrs')
    expect(screen.getByTitle('No attributes')).toHaveTextContent('no attrs')
  })

  it('switches to inline attributes without expandable rows', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [sampleLogs[0], { ...sampleLogs[1], attributes: {} }],
    } as Response)

    render(Logs)
    await screen.findByText('checkout failed')
    expect(
      screen.getAllByRole('button', { name: 'Show attributes' }),
    ).toHaveLength(1)

    await fireEvent.click(
      screen.getByRole('button', { name: 'Inline attributes' }),
    )

    expect(
      screen.queryByRole('button', { name: 'Show attributes' }),
    ).not.toBeInTheDocument()
    const inline = screen.getAllByTestId('log-inline-attributes')
    expect(inline).toHaveLength(1)
    expect(inline[0]).toHaveTextContent('http.route')
    expect(inline[0]).toHaveTextContent('/checkout')
    expect(screen.getAllByTestId('log-row')).toHaveLength(2)
    expect(window.location.search).toContain('attrs=inline')

    await fireEvent.click(screen.getByRole('button', { name: 'Expandable' }))
    expect(
      screen.queryByTestId('log-inline-attributes'),
    ).not.toBeInTheDocument()
  })

  describe('attribute filters', () => {
    const attributeLogs = [
      {
        ...sampleLogs[0],
        id: 'a',
        body: 'log a',
        attributes: { region: 'eu-west-1', 'http.status_code': 500 },
      },
      {
        ...sampleLogs[0],
        id: 'b',
        body: 'log b',
        attributes: { region: 'us-east-1', 'http.status_code': 200 },
      },
      { ...sampleLogs[0], id: 'c', body: 'log c', attributes: {} },
    ]

    async function renderWithAttributeLogs(firstVisible = 'log a') {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => attributeLogs,
      } as Response)
      render(Logs)
      await screen.findByText(firstVisible)
    }

    async function addFilter(text: string) {
      const input = screen.getByLabelText('Filter by attributes')
      await fireEvent.input(input, { target: { value: text } })
      await fireEvent.keyDown(input, { key: 'Enter' })
    }

    function visibleBodies() {
      return screen
        .getAllByTestId('log-row')
        .map((row) => /log [abc]/.exec(row.textContent ?? '')?.[0])
    }

    it.each([
      ['region', ['log a', 'log b']],
      ['!region', ['log c']],
      ['region=eu-west-1', ['log a']],
      ['region=EU-WEST-1', null],
      ['Region', null],
      ['region!=eu-west-1', ['log b', 'log c']],
      ['region~WEST', ['log a']],
      ['region!~west', ['log b', 'log c']],
      ['http.status_code=500', ['log a']],
    ])('filters with %s', async (filter, expected) => {
      await renderWithAttributeLogs()
      await addFilter(filter)

      if (expected === null) {
        expect(screen.queryAllByTestId('log-row')).toHaveLength(0)
      } else {
        expect(visibleBodies().sort()).toEqual(expected)
      }
    })

    it('combines chips with AND and removes them', async () => {
      await renderWithAttributeLogs()
      await addFilter('region')
      await addFilter('http.status_code=200')

      expect(visibleBodies()).toEqual(['log b'])
      expect(window.location.search).toContain('attr=region')
      expect(window.location.search).toContain('attr=http.status_code%3D200')

      await fireEvent.click(
        screen.getByRole('button', {
          name: 'Remove filter http.status_code=200',
        }),
      )
      expect(visibleBodies().sort()).toEqual(['log a', 'log b'])
    })

    it('restores chips from the URL and clears them', async () => {
      const originalUrl = window.location.href
      window.history.replaceState(
        window.history.state,
        '',
        '/?tab=logs&attr=region%3Dus-east-1',
      )
      await renderWithAttributeLogs('log b')

      expect(screen.getAllByTestId('attribute-filter-chip')).toHaveLength(1)
      expect(visibleBodies()).toEqual(['log b'])

      await fireEvent.click(
        screen.getByRole('button', { name: 'Clear Filters' }),
      )
      expect(screen.queryAllByTestId('attribute-filter-chip')).toHaveLength(0)
      expect(visibleBodies().sort()).toEqual(['log a', 'log b', 'log c'])

      window.history.replaceState(window.history.state, '', originalUrl)
    })
  })

  it('shows loading before the initial logs fetch resolves', async () => {
    let resolveFetch!: (value: Response) => void
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })

    fetchMock.mockReturnValueOnce(pendingFetch)

    render(Logs)

    expect(screen.getByText('Loading logs…')).toBeInTheDocument()
    expect(screen.queryByText('No logs received yet.')).not.toBeInTheDocument()

    resolveFetch({
      ok: true,
      json: async () => [],
    } as Response)

    expect(await screen.findByText('No logs received yet.')).toBeInTheDocument()
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
    component.triggerDeleteSelected()

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
      '/?tab=logs&search=worker&service=worker-service&severity=info',
    )

    render(Logs)

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('worker-service')).toBeInTheDocument()
    expect(
      within(table).queryByText('checkout-service'),
    ).not.toBeInTheDocument()

    const searchInput = screen.getByLabelText('Search logs') as HTMLInputElement
    expect(searchInput.value).toBe('worker')

    const servicePicker = screen.getByLabelText('Service')
    expect(servicePicker).toHaveTextContent('worker-service')

    const severityPicker = screen.getByLabelText('Severity')
    expect(severityPicker).toHaveTextContent('Info')

    window.history.replaceState(window.history.state, '', originalUrl)
  })

  it('filters logs by selected service', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    render(Logs)

    const servicePicker = await screen.findByLabelText('Service')
    await fireEvent.click(servicePicker)
    await fireEvent.click(
      screen.getByRole('button', { name: 'worker-service' }),
    )

    const table = screen.getByRole('table')
    expect(await within(table).findByText('worker-service')).toBeInTheDocument()
    expect(
      within(table).queryByText('checkout-service'),
    ).not.toBeInTheDocument()
  })

  it('renders span links to trace details with spanId query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    window.history.replaceState(
      window.history.state,
      '',
      '/?tab=logs&search=checkout&severity=error',
    )

    render(Logs)

    const traceLink = await screen.findByRole('link', { name: 'trace-1' })
    expect(traceLink).toHaveAttribute(
      'href',
      '/traces/trace-1?returnTo=%2F%3Ftab%3Dlogs%26search%3Dcheckout%26severity%3Derror',
    )

    const spanLink = await screen.findByRole('link', { name: 'span-1' })
    expect(spanLink).toHaveAttribute(
      'href',
      '/traces/trace-1?returnTo=%2F%3Ftab%3Dlogs%26search%3Dcheckout%26severity%3Derror&spanId=span-1',
    )
  })

  it('updates trace links when filters change', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLogs,
    } as Response)

    window.history.replaceState(window.history.state, '', '/?tab=logs')

    render(Logs)

    const searchInput = await screen.findByLabelText('Search logs')
    await fireEvent.input(searchInput, { target: { value: 'checkout' } })

    const severityPicker = screen.getByLabelText('Severity')
    await fireEvent.click(severityPicker)
    await fireEvent.click(screen.getByRole('button', { name: 'Error+' }))

    const traceLink = await screen.findByRole('link', { name: 'trace-1' })
    expect(traceLink).toHaveAttribute(
      'href',
      '/traces/trace-1?returnTo=%2F%3Ftab%3Dlogs%26search%3Dcheckout%26severity%3Derror',
    )
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
