// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/svelte'

const { mockReplaceState } = vi.hoisted(() => ({
  mockReplaceState: vi.fn(),
}))

const { mockPushState } = vi.hoisted(() => ({
  mockPushState: vi.fn(),
}))

const { mockCheckForUpdate, mockDismissUpdate } = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn().mockResolvedValue(null),
  mockDismissUpdate: vi.fn(),
}))

const { mockTraceStore } = vi.hoisted(() => ({
  mockTraceStore: {
    connectSSE: vi.fn(),
    tracesLoaded: true,
    traces: [
      {
        traceId: 'trace-checkout-1',
        rootSpanName: 'HTTP GET /checkout',
        serviceName: 'checkout-service',
        allServices: ['checkout-service', 'inventory-service'],
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
        allServices: ['inventory-service'],
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
    maxLogs: 1000,
    logCount: 0,
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
  pushState: mockPushState,
  replaceState: mockReplaceState,
}))

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')

  return {
    page: readable({
      params: {},
      url: new URL(
        'http://localhost/?search=checkout&service=checkout-service&errors=true&minDuration=10&maxDuration=20',
      ),
    }),
  }
})

vi.mock('$lib/utils/updateCheck', () => ({
  checkForUpdate: mockCheckForUpdate,
  dismissUpdate: mockDismissUpdate,
}))

vi.mock('$lib/stores/traces.svelte', () => ({
  traceStore: mockTraceStore,
}))

import Page from './+page.svelte'

describe('trace list page', () => {
  beforeEach(() => {
    mockReplaceState.mockClear()
    mockPushState.mockClear()
    mockCheckForUpdate.mockClear()
    mockDismissUpdate.mockClear()

    window.history.replaceState(
      {},
      '',
      '/?search=checkout&service=checkout-service&errors=true&minDuration=10&maxDuration=20',
    )

    // Emulate SvelteKit pushState by updating the browser location in tests.
    mockPushState.mockImplementation((url: URL) => {
      window.history.pushState({}, '', url)
    })

    mockTraceStore.logCount = 0
  })

  it('keeps the logs badge count after page remount', async () => {
    mockTraceStore.logCount = 7

    const firstRender = render(Page)
    const firstLogsTab = screen.getByRole('tab', { name: /^Logs/ })
    expect(within(firstLogsTab).getByText('7')).toBeInTheDocument()

    firstRender.unmount()

    render(Page)
    const secondLogsTab = screen.getByRole('tab', { name: /^Logs/ })
    expect(within(secondLogsTab).getByText('7')).toBeInTheDocument()
  })

  it('syncs logs tab selection into the URL', async () => {
    render(Page)

    mockPushState.mockClear()

    await fireEvent.click(screen.getByRole('tab', { name: 'Logs' }))

    await waitFor(() => {
      expect(mockPushState).toHaveBeenCalled()
    })

    const callArgs = mockPushState.mock.calls.at(-1)
    const url = callArgs?.[0] as URL
    expect(url.href).toContain('tab=logs')
  })

  it('clears all params when switching directly from traces to logs', async () => {
    render(Page)

    mockPushState.mockClear()

    await fireEvent.click(screen.getByRole('tab', { name: 'Logs' }))

    await waitFor(() => {
      expect(mockPushState).toHaveBeenCalled()
    })

    const callArgs = mockPushState.mock.calls.at(-1)
    const url = callArgs?.[0] as URL
    expect(url.search).toBe('?tab=logs')
  })

  it('clears all params when switching directly from logs to traces', async () => {
    render(Page)

    // First go to Logs tab
    await fireEvent.click(screen.getByRole('tab', { name: /^Logs/ }))

    await waitFor(() => {
      const logsTab = screen.getByRole('tab', { name: /^Logs/ })
      expect(logsTab).toHaveAttribute('aria-selected', 'true')
    })

    mockPushState.mockClear()

    // Now click Traces tab (use regex to match "Traces" with optional count badge)
    const allTabs = screen.getAllByRole('tab')
    const tracesTab = allTabs[0] // First tab is Traces
    await fireEvent.click(tracesTab)

    await waitFor(() => {
      expect(mockPushState).toHaveBeenCalled()
    })

    const callArgs = mockPushState.mock.calls.at(-1)
    const url = callArgs?.[0] as URL
    // Should restore the previous Traces URL state from before switching to Logs.
    expect(url.searchParams.get('search')).toBe('checkout')
    expect(url.searchParams.get('service')).toBe('checkout-service')
    expect(url.searchParams.get('tab')).toBeNull()
  })

  it('restores tab state when switching between tabs', async () => {
    render(Page)

    // 1. Set search to "a" on Traces tab
    await fireEvent.input(screen.getByLabelText('Search'), {
      target: { value: 'a' },
    })

    await waitFor(() => {
      expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(
        'a',
      )
    })

    // Manually update location to simulate Traces component updating URL
    const tracesUrlWithSearch = new URL(window.location.href)
    tracesUrlWithSearch.searchParams.set('search', 'a')
    window.history.replaceState({}, '', tracesUrlWithSearch)

    expect(window.location.href).toContain('search=a')

    mockPushState.mockClear()

    // 2. Switch to Logs tab
    await fireEvent.click(screen.getByRole('tab', { name: /^Logs/ }))

    await waitFor(() => {
      const logsTab = screen.getByRole('tab', { name: /^Logs/ })
      expect(logsTab).toHaveAttribute('aria-selected', 'true')
    })

    // 3. Verify Logs URL is clean (only has tab=logs)
    const logsUrl = new URL(window.location.href)
    expect(logsUrl.searchParams.get('tab')).toBe('logs')
    expect(logsUrl.searchParams.get('search')).toBeNull()

    mockPushState.mockClear()

    // 4. Switch back to Traces tab
    const allTabs = screen.getAllByRole('tab')
    const tracesTab = allTabs[0]
    await fireEvent.click(tracesTab)

    await waitFor(() => {
      const tab = screen.getByRole('tab', { name: /^Traces/ })
      expect(tab).toHaveAttribute('aria-selected', 'true')
    })

    // 5. Verify Traces URL is restored with search="a"
    const restoredUrl = new URL(window.location.href)
    expect(restoredUrl.searchParams.get('search')).toBe('a')
    expect(restoredUrl.searchParams.get('tab')).toBeNull() // Traces has no tab param

    await waitFor(() => {
      expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(
        'a',
      )
    })
  })

  it('applies service filter when selecting a service node from Service Map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          {
            serviceName: 'checkout-service',
            spanCount: 4,
            errorCount: 1,
            nodeType: 'service',
          },
          {
            serviceName: 'inventory-service',
            spanCount: 3,
            errorCount: 0,
            nodeType: 'service',
          },
        ],
        edges: [
          {
            source: 'checkout-service',
            target: 'inventory-service',
            callCount: 2,
            errorCount: 0,
            p50Ms: 10,
            p99Ms: 20,
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(Page)

    await fireEvent.click(screen.getByRole('tab', { name: 'Service Map' }))

    const checkoutNodeLabel = await screen.findByText('checkout-service')
    await fireEvent.click(checkoutNodeLabel)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^Traces/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByLabelText('Service')).toHaveTextContent(
        'checkout-service',
      )
      expect(screen.getByLabelText('Root Only')).not.toBeChecked()
    })
  })
})
