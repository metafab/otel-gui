// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

import type { StoredSpan } from '$lib/types'

const { mockFetchTrace, mockGoto, mockReplaceState } = vi.hoisted(() => ({
  mockFetchTrace: vi.fn(),
  mockGoto: vi.fn(),
  mockReplaceState: vi.fn(),
}))

const { mockPageState } = vi.hoisted(() => ({
  mockPageState: {
    params: { traceId: 'trace-nested' },
    url: new URL('http://localhost/traces/trace-nested'),
  },
}))

const { mockFetchTraceLogs } = vi.hoisted(() => ({
  mockFetchTraceLogs: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  goto: mockGoto,
  replaceState: mockReplaceState,
}))

vi.mock('$app/stores', () => {
  return {
    page: {
      subscribe(run: (value: typeof mockPageState) => void) {
        run(mockPageState)
        return () => {}
      },
    },
  }
})

vi.mock('$lib/stores/traces.svelte', () => ({
  traceStore: {
    connectSSE: vi.fn(),
    traces: [],
    fetchTrace: mockFetchTrace,
    fetchTraceLogs: mockFetchTraceLogs,
  },
}))

import { traceStore } from '$lib/stores/traces.svelte'
import TracePage from './+page.svelte'

const mutableTraceStore = traceStore as unknown as {
  traces: Array<{ traceId: string; updatedAt: number }>
}

let scrolledElements: Element[] = []

function makeSpan(overrides: Partial<StoredSpan> = {}): StoredSpan {
  return {
    traceId: 'trace-nested',
    spanId: 'span-default',
    parentSpanId: '',
    name: 'default-span',
    kind: 1,
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    attributes: {},
    events: [],
    links: [],
    status: { code: 0, message: '' },
    resource: { 'service.name': 'checkout-service' },
    scopeName: 'test-scope',
    scopeVersion: '1.0.0',
    scopeAttributes: {},
    ...overrides,
  }
}

describe('traces/[traceId] page search UI', () => {
  beforeEach(() => {
    scrolledElements = []
    mutableTraceStore.traces = []
    mockGoto.mockClear()
    mockReplaceState.mockClear()
    mockPageState.params = { traceId: 'trace-nested' }
    mockPageState.url = new URL('http://localhost/traces/trace-nested')

    window.history.replaceState({}, '', '/traces/trace-nested')

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'http://localhost/?search=checkout',
    })

    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value(_options?: ScrollIntoViewOptions) {
        scrolledElements.push(this)
      },
      writable: true,
      configurable: true,
    })

    const rootSpan = makeSpan({
      spanId: 'root-span',
      parentSpanId: '',
      name: 'HTTP GET /checkout',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '8000000000',
    })

    const childSpan = makeSpan({
      spanId: 'child-hidden-span',
      parentSpanId: 'root-span',
      name: 'SELECT products',
      startTimeUnixNano: '2000000000',
      endTimeUnixNano: '6000000000',
      attributes: {
        'cart.items': '3',
        'db.statement': 'SELECT * FROM products WHERE id = ?',
      },
      events: [
        {
          name: 'db.query',
          timeUnixNano: '3000000000',
          attributes: { 'db.operation': 'select' },
        },
      ],
    })

    mockFetchTrace.mockResolvedValue({
      traceId: 'trace-nested',
      rootSpanName: rootSpan.name,
      serviceName: 'checkout-service',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '8000000000',
      updatedAt: Date.now(),
      spanCount: 2,
      hasError: false,
      spans: {
        [rootSpan.spanId]: rootSpan,
        [childSpan.spanId]: childSpan,
      },
    })

    mockFetchTraceLogs.mockResolvedValue([])

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [] }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('finds matches in collapsed descendant spans and shows match count', async () => {
    const { container } = render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    expect(screen.getByText('0 logs')).toBeInTheDocument()

    await waitFor(() => {
      expect(
        container.querySelector('[data-span-id="child-hidden-span"]'),
      ).toBeTruthy()
    })

    const collapseBtn = screen.getByRole('button', { name: 'Collapse' })
    await fireEvent.click(collapseBtn)

    await waitFor(() => {
      expect(
        container.querySelector('[data-span-id="child-hidden-span"]'),
      ).toBeNull()
    })

    const searchInput = screen.getByPlaceholderText('Search spans…')
    await fireEvent.input(searchInput, {
      target: { value: 'select * from products' },
    })

    expect(screen.getByText('1 span found')).toBeInTheDocument()
  })

  it('shows a no-match message when span search has zero results', async () => {
    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search spans…')
    await fireEvent.input(searchInput, {
      target: { value: 'this-query-does-not-match-any-span' },
    })

    expect(screen.getByText('No matching spans')).toBeInTheDocument()
  })

  it('auto-selects the first search match', async () => {
    const { container } = render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search spans…')
    searchInput.focus()

    await waitFor(() => {
      expect(searchInput).toHaveFocus()
    })

    await fireEvent.input(searchInput, {
      target: { value: 'select * from products' },
    })

    await waitFor(() => {
      expect(screen.getByText('1 span found')).toBeInTheDocument()
    })

    await waitFor(() => {
      const selectedMatchRow = container.querySelector(
        '[data-span-id="child-hidden-span"] .waterfall-row',
      )
      expect(selectedMatchRow).toHaveClass('selected')
    })

    expect(searchInput).toHaveFocus()
  })

  it('scrolls span details to matching attribute when search matches an attribute key', async () => {
    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    scrolledElements = []

    const searchInput = screen.getByPlaceholderText('Search spans…')
    await fireEvent.input(searchInput, {
      target: { value: 'cart.i' },
    })

    await waitFor(() => {
      expect(screen.getByText('1 span found')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(
        scrolledElements.some(
          (el) =>
            el.classList.contains('match-segment') &&
            el.classList.contains('is-match'),
        ),
      ).toBe(true)
    })
  })

  it('shows a refresh split-menu and toggles auto-refresh from it', async () => {
    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    const optionsButton = screen.getByRole('button', {
      name: 'Refresh options',
    })
    await fireEvent.click(optionsButton)

    const enableAutoRefreshButton = screen.getByRole('menuitem', {
      name: 'Enable Auto-Refresh',
    })
    await fireEvent.click(enableAutoRefreshButton)

    await fireEvent.click(optionsButton)
    expect(
      screen.getByRole('menuitem', { name: 'Disable Auto-Refresh' }),
    ).toBeInTheDocument()
  })

  it('auto-refreshes when enabled and newer data is available', async () => {
    mutableTraceStore.traces = [
      {
        traceId: 'trace-nested',
        updatedAt: 200,
      },
    ]

    const rootSpan = makeSpan({
      spanId: 'root-span',
      parentSpanId: '',
      name: 'HTTP GET /checkout',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '8000000000',
    })

    mockFetchTrace.mockReset()
    mockFetchTrace
      .mockResolvedValueOnce({
        traceId: 'trace-nested',
        rootSpanName: rootSpan.name,
        serviceName: 'checkout-service',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '8000000000',
        updatedAt: 100,
        spanCount: 1,
        hasError: false,
        spans: {
          [rootSpan.spanId]: rootSpan,
        },
      })
      .mockResolvedValueOnce({
        traceId: 'trace-nested',
        rootSpanName: rootSpan.name,
        serviceName: 'checkout-service',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '8000000000',
        updatedAt: 100,
        spanCount: 1,
        hasError: false,
        spans: {
          [rootSpan.spanId]: rootSpan,
        },
      })
      .mockResolvedValue({
        traceId: 'trace-nested',
        rootSpanName: rootSpan.name,
        serviceName: 'checkout-service',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '8000000000',
        updatedAt: 250,
        spanCount: 1,
        hasError: false,
        spans: {
          [rootSpan.spanId]: rootSpan,
        },
      })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    const callsBeforeEnable = mockFetchTrace.mock.calls.length
    const optionsButton = screen.getByRole('button', {
      name: 'Refresh options',
    })
    await fireEvent.click(optionsButton)
    await fireEvent.click(
      screen.getByRole('menuitem', { name: 'Enable Auto-Refresh' }),
    )

    await waitFor(() => {
      expect(mockFetchTrace.mock.calls.length).toBeGreaterThan(
        callsBeforeEnable,
      )
    })
  })

  it('falls back to the trace list when no list referrer is available', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Traces' }),
    )

    expect(mockGoto).toHaveBeenCalledWith('/')
  })

  it('restores traces query params from returnTo when available', async () => {
    mockPageState.url = new URL(
      'http://localhost/traces/trace-nested?returnTo=%2F%3Fsearch%3Dcheckout%26service%3Dcheckout-service%26sort%3Dduration%26order%3Dasc',
    )

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Traces' }),
    )

    expect(mockGoto).toHaveBeenCalledWith(
      '/?search=checkout&service=checkout-service&sort=duration&order=asc',
    )
  })

  it('returns to logs with filters when returnTo comes from the Logs tab', async () => {
    mockPageState.url = new URL(
      'http://localhost/traces/trace-nested?returnTo=%2F%3Ftab%3Dlogs%26search%3Derror%26severity%3Dwarn%26sort%3Dservice%26order%3Dasc',
    )

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Logs' }),
    )

    expect(mockGoto).toHaveBeenCalledWith(
      '/?tab=logs&search=error&severity=warn&sort=service&order=asc',
    )
  })

  it('returns to a log detail page when returnTo points to a log detail page', async () => {
    mockPageState.url = new URL(
      'http://localhost/traces/trace-nested?returnTo=%2Flogs%2Flog-123%3FreturnTo%3D%252F%253Ftab%253Dlogs%2526search%253Derror%2526severity%253Dwarn',
    )

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: '← Back to Log' }))

    expect(mockGoto).toHaveBeenCalledWith(
      '/logs/log-123?returnTo=%2F%3Ftab%3Dlogs%26search%3Derror%26severity%3Dwarn',
    )
  })

  it('ignores returnTo that points to a non-traces tab', async () => {
    mockPageState.url = new URL(
      'http://localhost/traces/trace-nested?returnTo=%2F%3Ftab%3Dmap%26search%3Dcheckout',
    )

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Traces' }),
    )

    expect(mockGoto).toHaveBeenCalledWith('/')
  })

  it('ignores map-like referrer and still returns to traces tab', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'http://localhost/?tab=map',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Traces' }),
    )

    expect(mockGoto).toHaveBeenCalledWith('/')
  })

  it('navigates back to trace list on Esc when no referrer is available', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(mockGoto).toHaveBeenCalledWith('/')
  })

  it('clears focused span search on Esc before navigating back', async () => {
    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace…')).not.toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search spans…')
    await fireEvent.input(searchInput, {
      target: { value: 'select products' },
    })

    expect((searchInput as HTMLInputElement).value).toBe('select products')

    searchInput.focus()
    await fireEvent.keyDown(document, { key: 'Escape' })

    expect((searchInput as HTMLInputElement).value).toBe('')
    expect(mockGoto).not.toHaveBeenCalled()
  })
})
