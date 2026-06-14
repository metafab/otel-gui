// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const { mockGoto } = vi.hoisted(() => ({
  mockGoto: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  goto: mockGoto,
}))

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')

  return {
    page: readable({
      params: { logId: 'log-123' },
      url: new URL('http://localhost/logs/log-123'),
    }),
  }
})

import LogDetailPage from './+page.svelte'

describe('logs/[logId] page', () => {
  beforeEach(() => {
    mockGoto.mockReset()

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'log-123',
          traceId: 'trace-abc',
          spanId: 'span-xyz',
          timeUnixNano: '1715803200000000000',
          observedTimeUnixNano: '1715803201000000000',
          severityNumber: 17,
          severityText: 'ERROR',
          body: { message: 'checkout failed', retryCount: 2 },
          serviceName: 'checkout-service',
          attributes: {
            'http.method': 'POST',
            'http.status_code': 500,
          },
          resource: {
            'service.name': 'checkout-service',
          },
          scopeName: 'logger-scope',
          scopeVersion: '1.2.3',
          scopeAttributes: {
            'scope.attr': 'scope-value',
          },
        }),
      }),
    )
  })

  it('renders log header and attribute/resource sections', async () => {
    render(LogDetailPage)

    expect(await screen.findByText('Log log-123')).toBeInTheDocument()
    expect(screen.getByText('http.method')).toBeInTheDocument()
    expect(screen.getByText('service.name')).toBeInTheDocument()
    expect(screen.getByText('logger-scope')).toBeInTheDocument()
  })

  it('navigates back to logs on Esc when no filter is focused', async () => {
    render(LogDetailPage)
    await screen.findByText('Log log-123')

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(mockGoto).toHaveBeenCalledWith('/?tab=logs')
  })

  it('back button navigates to /?tab=logs', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(LogDetailPage)
    await screen.findByText('Log log-123')

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Logs' }),
    )

    expect(mockGoto).toHaveBeenCalledWith('/?tab=logs')
  })

  it('clears focused filter on Esc before navigating back', async () => {
    render(LogDetailPage)
    await screen.findByText('Log log-123')

    const attributesFilter = screen.getByPlaceholderText('Filter attributes...')
    await fireEvent.input(attributesFilter, { target: { value: 'http' } })

    expect((attributesFilter as HTMLInputElement).value).toBe('http')

    attributesFilter.focus()
    await fireEvent.keyDown(document, { key: 'Escape' })

    expect((attributesFilter as HTMLInputElement).value).toBe('')
    expect(mockGoto).not.toHaveBeenCalled()
  })
})
