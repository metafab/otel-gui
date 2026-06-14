// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import Logs from './Logs.svelte'

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
    vi.stubGlobal('confirm', vi.fn(() => true))
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

  it('deletes selected logs', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleLogs,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, deletedCount: 1, mode: 'selected' }),
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
})