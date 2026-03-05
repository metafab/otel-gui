// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

import type { StoredSpan } from '$lib/types'

const { mockFetchTrace } = vi.hoisted(() => ({
  mockFetchTrace: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  replaceState: vi.fn(),
}))

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')

  return {
    page: readable({
      params: { traceId: 'trace-nested' },
      url: new URL('http://localhost/trace/trace-nested'),
    }),
  }
})

vi.mock('$lib/stores/traces.svelte', () => ({
  traceStore: {
    fetchTrace: mockFetchTrace,
  },
}))

import TracePage from './+page.svelte'

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

describe('trace/[traceId] page search UI', () => {
  beforeEach(() => {
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
      spanCount: 2,
      hasError: false,
      spans: {
        [rootSpan.spanId]: rootSpan,
        [childSpan.spanId]: childSpan,
      },
    })

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
      expect(container.querySelector('[data-span-id="child-hidden-span"]')).toBeTruthy()
    })

    const collapseBtn = screen.getByRole('button', { name: 'Collapse' })
    await fireEvent.click(collapseBtn)

    await waitFor(() => {
      expect(container.querySelector('[data-span-id="child-hidden-span"]')).toBeNull()
    })

    const searchInput = screen.getByPlaceholderText('Search spans...')
    await fireEvent.input(searchInput, {
      target: { value: 'select * from products' },
    })

    expect(screen.getByText('1 span found')).toBeInTheDocument()
  })
})
