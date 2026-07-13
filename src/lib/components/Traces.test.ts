// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const { mockReplaceState } = vi.hoisted(() => ({
  mockReplaceState: vi.fn(),
}))

const { traceStoreMock } = vi.hoisted(() => ({
  traceStoreMock: {
    tracesLoaded: true,
    traces: [
      {
        traceId: 'trace-checkout-1',
        rootSpanName: 'HTTP GET /checkout',
        serviceName: 'checkout-service',
        durationMs: 12,
        spanCount: 4,
        hasError: true,
        startTime: '2026-04-12T12:00:00.000Z',
        updatedAt: 1,
        rootSpanTentative: false,
      },
      {
        traceId: 'trace-inventory-1',
        rootSpanName: 'GET /inventory',
        serviceName: 'inventory-service',
        durationMs: 42,
        spanCount: 3,
        hasError: false,
        startTime: '2026-04-12T12:05:00.000Z',
        updatedAt: 2,
        rootSpanTentative: false,
      },
    ],
    error: null,
    isLoading: false,
    maxTraces: 1000,
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
    clearAllTraces: vi.fn(),
    deleteSelectedTraces: vi.fn().mockResolvedValue(0),
  },
}))

vi.mock('$app/navigation', () => ({
  replaceState: mockReplaceState,
  pushState: vi.fn(),
}))

// Mock VersionInfo so it doesn't consume any fetch mock
vi.mock('$lib/utils/updateCheck', () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  dismissUpdate: vi.fn(),
}))

vi.mock('$lib/stores/traces.svelte', () => ({
  traceStore: traceStoreMock,
}))

import Traces from './Traces.svelte'

describe('Traces', () => {
  beforeEach(() => {
    mockReplaceState.mockClear()
    traceStoreMock.tracesLoaded = true
    traceStoreMock.traces = [
      {
        traceId: 'trace-checkout-1',
        rootSpanName: 'HTTP GET /checkout',
        serviceName: 'checkout-service',
        durationMs: 12,
        spanCount: 4,
        hasError: true,
        startTime: '2026-04-12T12:00:00.000Z',
        updatedAt: 1,
        rootSpanTentative: false,
      },
      {
        traceId: 'trace-inventory-1',
        rootSpanName: 'GET /inventory',
        serviceName: 'inventory-service',
        durationMs: 42,
        spanCount: 3,
        hasError: false,
        startTime: '2026-04-12T12:05:00.000Z',
        updatedAt: 2,
        rootSpanTentative: false,
      },
    ]
    window.history.replaceState(
      {},
      '',
      '/?search=checkout&service=checkout-service&errors=true&minDuration=10&maxDuration=20',
    )
  })

  it('shows loading before the first traces payload arrives', () => {
    traceStoreMock.tracesLoaded = false
    traceStoreMock.traces = []

    render(Traces)

    expect(screen.getByText('Loading traces…')).toBeInTheDocument()
    expect(screen.queryByText('No traces received yet.')).not.toBeInTheDocument()
  })

  it('restores filters from the list page query params', () => {
    render(Traces)

    expect(screen.getByLabelText('Search')).toHaveValue('checkout')
    expect(screen.getByLabelText('Service')).toHaveValue('checkout-service')
    expect(screen.getByLabelText('Errors Only')).toBeChecked()
    expect(screen.getByLabelText('Min Duration (ms)')).toHaveValue(10)
    expect(screen.getByLabelText('Max Duration (ms)')).toHaveValue(20)

    expect(screen.getByText('HTTP GET /checkout')).toBeInTheDocument()
    expect(screen.queryByText('GET /inventory')).not.toBeInTheDocument()
  })

  it('syncs filter edits back into the URL', async () => {
    render(Traces)

    mockReplaceState.mockClear()

    await fireEvent.input(screen.getByLabelText('Search'), {
      target: { value: 'inventory' },
    })

    await waitFor(() => {
      expect(mockReplaceState).toHaveBeenCalled()
    })

    const url = mockReplaceState.mock.calls.at(-1)?.[0] as URL

    expect(url.searchParams.get('search')).toBe('inventory')
    expect(url.searchParams.get('service')).toBe('checkout-service')
    expect(url.searchParams.get('errors')).toBe('true')
    expect(url.searchParams.get('minDuration')).toBe('10')
    expect(url.searchParams.get('maxDuration')).toBe('20')
  })

  it('defaults to time descending sort state', () => {
    render(Traces)

    const timeHeader = screen.getByRole('columnheader', { name: 'Time ↓' })
    const durationHeader = screen.getByRole('columnheader', {
      name: 'Duration',
    })

    expect(timeHeader).toHaveAttribute('aria-sort', 'descending')
    expect(durationHeader).toHaveAttribute('aria-sort', 'none')
  })

  it('syncs duration sort edits back into the URL', async () => {
    render(Traces)

    mockReplaceState.mockClear()

    await fireEvent.click(
      screen.getByRole('button', { name: 'Sort by duration' }),
    )

    await waitFor(() => {
      expect(mockReplaceState).toHaveBeenCalled()
    })

    let url = mockReplaceState.mock.calls.at(-1)?.[0] as URL
    expect(url.searchParams.get('sort')).toBe('duration')
    expect(url.searchParams.get('order')).toBe('asc')

    await fireEvent.click(
      screen.getByRole('button', { name: 'Sort by duration' }),
    )

    await waitFor(() => {
      const latestUrl = mockReplaceState.mock.calls.at(-1)?.[0] as URL
      expect(latestUrl.searchParams.get('order')).toBe('desc')
    })

    url = mockReplaceState.mock.calls.at(-1)?.[0] as URL
    expect(url.searchParams.get('sort')).toBe('duration')
    expect(url.searchParams.get('order')).toBe('desc')
  })

  it('syncs root service sort edits back into the URL', async () => {
    render(Traces)

    mockReplaceState.mockClear()

    await fireEvent.click(
      screen.getByRole('button', { name: 'Sort by root service' }),
    )

    await waitFor(() => {
      expect(mockReplaceState).toHaveBeenCalled()
    })

    const url = mockReplaceState.mock.calls.at(-1)?.[0] as URL
    expect(url.searchParams.get('sort')).toBe('rootService')
    expect(url.searchParams.get('order')).toBe('asc')
  })

  it('syncs logs sort edits back into the URL', async () => {
    render(Traces)

    mockReplaceState.mockClear()

    await fireEvent.click(screen.getByRole('button', { name: 'Sort by logs' }))

    await waitFor(() => {
      expect(mockReplaceState).toHaveBeenCalled()
    })

    let url = mockReplaceState.mock.calls.at(-1)?.[0] as URL
    expect(url.searchParams.get('sort')).toBe('logs')
    expect(url.searchParams.get('order')).toBe('asc')

    await fireEvent.click(screen.getByRole('button', { name: 'Sort by logs' }))

    await waitFor(() => {
      const latestUrl = mockReplaceState.mock.calls.at(-1)?.[0] as URL
      expect(latestUrl.searchParams.get('order')).toBe('desc')
    })

    url = mockReplaceState.mock.calls.at(-1)?.[0] as URL
    expect(url.searchParams.get('sort')).toBe('logs')
    expect(url.searchParams.get('order')).toBe('desc')
  })

  it('shows traces retention footer', () => {
    render(Traces)

    const retentionNotice = document.querySelector('.retention-notice')
    expect(retentionNotice).not.toBeNull()
    expect(retentionNotice).toHaveTextContent('Keeping last 1000 traces')
    expect(retentionNotice).toHaveTextContent('in memory only')
  })
})
