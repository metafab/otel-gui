// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const { mockReplaceState } = vi.hoisted(() => ({
  mockReplaceState: vi.fn(),
}))

const { mockCheckForUpdate, mockDismissUpdate } = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn().mockResolvedValue(null),
  mockDismissUpdate: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
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
  traceStore: {
    connectSSE: vi.fn(),
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

import Page from './+page.svelte'

describe('trace list page URL filters', () => {
  beforeEach(() => {
    mockReplaceState.mockClear()
    mockCheckForUpdate.mockClear()
    mockDismissUpdate.mockClear()

    window.history.replaceState(
      {},
      '',
      '/?search=checkout&service=checkout-service&errors=true&minDuration=10&maxDuration=20',
    )
  })

  it('restores filters from the list page query params', () => {
    render(Page)

    expect(screen.getByLabelText('Search')).toHaveValue('checkout')
    expect(screen.getByLabelText('Service')).toHaveValue('checkout-service')
    expect(screen.getByLabelText('Errors Only')).toBeChecked()
    expect(screen.getByLabelText('Min Duration (ms)')).toHaveValue(10)
    expect(screen.getByLabelText('Max Duration (ms)')).toHaveValue(20)

    expect(screen.getByText('HTTP GET /checkout')).toBeInTheDocument()
    expect(screen.queryByText('GET /inventory')).not.toBeInTheDocument()
  })

  it('syncs filter edits back into the URL', async () => {
    render(Page)

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
})
