// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

import type { StoredSpan } from '$lib/types'

const { mockFetchTrace } = vi.hoisted(() => ({
  mockFetchTrace: vi.fn(),
}))

const { mockFetchTraceLogs } = vi.hoisted(() => ({
  mockFetchTraceLogs: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  replaceState: vi.fn(),
}))

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')

  return {
    page: readable({
      params: { traceId: 'trace-nested' },
      url: new URL('http://localhost/traces/trace-nested'),
    }),
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
    mutableTraceStore.traces = []

    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: vi.fn(),
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
      expect(screen.queryByText('Loading trace...')).not.toBeInTheDocument()
    })

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

    const searchInput = screen.getByPlaceholderText('Search spans...')
    await fireEvent.input(searchInput, {
      target: { value: 'select * from products' },
    })

    expect(screen.getByText('1 span found')).toBeInTheDocument()
  })

  it('shows a refresh split-menu and toggles auto-refresh from it', async () => {
    render(TracePage)

    await waitFor(() => {
      expect(screen.queryByText('Loading trace...')).not.toBeInTheDocument()
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
      expect(screen.queryByText('Loading trace...')).not.toBeInTheDocument()
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
})
