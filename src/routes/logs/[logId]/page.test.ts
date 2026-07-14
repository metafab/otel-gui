// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const { mockGoto } = vi.hoisted(() => ({
  mockGoto: vi.fn(),
}))

const { mockPageState } = vi.hoisted(() => ({
  mockPageState: {
    params: { logId: 'log-123' },
    url: new URL('http://localhost/logs/log-123'),
  },
}))

vi.mock('$app/navigation', () => ({
  goto: mockGoto,
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

import LogDetailPage from './+page.svelte'

describe('logs/[logId] page', () => {
  beforeEach(() => {
    mockGoto.mockReset()
    mockPageState.params = { logId: 'log-123' }
    mockPageState.url = new URL('http://localhost/logs/log-123')

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

  it('uses the log detail URL as returnTo for trace links', async () => {
    mockPageState.url = new URL(
      'http://localhost/logs/log-123?returnTo=%2F%3Ftab%3Dlogs%26search%3Derror%26severity%3Dwarn%26sort%3Dservice%26order%3Dasc',
    )

    render(LogDetailPage)

    await screen.findByText('Log log-123')

    const traceLink = screen.getByRole('link', { name: 'trace trace-abc' })
    expect(traceLink).toHaveAttribute(
      'href',
      '/traces/trace-abc?returnTo=%2Flogs%2Flog-123%3FreturnTo%3D%252F%253Ftab%253Dlogs%2526search%253Derror%2526severity%253Dwarn%2526sort%253Dservice%2526order%253Dasc',
    )

    const spanLink = screen.getByRole('link', { name: 'span span-xyz' })
    expect(spanLink).toHaveAttribute(
      'href',
      '/traces/trace-abc?returnTo=%2Flogs%2Flog-123%3FreturnTo%3D%252F%253Ftab%253Dlogs%2526search%253Derror%2526severity%253Dwarn%2526sort%253Dservice%2526order%253Dasc&spanId=span-xyz',
    )
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

  it('ignores map-like referrer and still returns to logs tab', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'http://localhost/?tab=map',
    })

    render(LogDetailPage)
    await screen.findByText('Log log-123')

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Logs' }),
    )

    expect(mockGoto).toHaveBeenCalledWith('/?tab=logs')
  })

  it('restores logs query params from returnTo when available', async () => {
    mockPageState.url = new URL(
      'http://localhost/logs/log-123?returnTo=%2F%3Ftab%3Dlogs%26search%3Derror%26severity%3Dwarn%26sort%3Dservice%26order%3Dasc',
    )

    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => '',
    })

    render(LogDetailPage)
    await screen.findByText('Log log-123')

    await fireEvent.click(
      screen.getByRole('button', { name: '← Back to Logs' }),
    )

    expect(mockGoto).toHaveBeenCalledWith(
      '/?tab=logs&search=error&severity=warn&sort=service&order=asc',
    )
  })

  it('ignores returnTo that points to a non-logs tab', async () => {
    mockPageState.url = new URL(
      'http://localhost/logs/log-123?returnTo=%2F%3Ftab%3Dmap%26search%3Derror',
    )

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
