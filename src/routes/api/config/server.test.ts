import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPersistenceStatus: vi.fn(),
}))

vi.mock('$lib/server/traceStore', () => ({
  traceStore: {
    maxTraces: 1000,
  },
  getPersistenceStatus: mocks.getPersistenceStatus,
}))

import { GET } from './+server'

describe('GET /api/config', () => {
  beforeEach(() => {
    mocks.getPersistenceStatus.mockReset()
  })

  it('returns persistence metadata from traceStore status', async () => {
    mocks.getPersistenceStatus.mockReturnValue({
      mode: 'memory',
      enabled: false,
      backend: null,
      path: null,
      flushMs: null,
      lastRestoreAt: null,
      restoredTraceCount: 0,
      pendingFlushCount: 0,
      unavailableReason: 'backend-unavailable-in-oss-build',
    })

    const response = await GET({} as any)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.maxTraces).toBe(1000)
    expect(body.persistence.unavailableReason).toBe(
      'backend-unavailable-in-oss-build',
    )
  })

  it('does not drop unavailableReason when persistence is disabled', async () => {
    mocks.getPersistenceStatus.mockReturnValue({
      mode: 'pglite',
      enabled: false,
      backend: null,
      path: '.otel-gui/pglite',
      flushMs: 750,
      lastRestoreAt: null,
      restoredTraceCount: 0,
      pendingFlushCount: 0,
      unavailableReason: 'backend-not-registered-by-module',
    })

    const response = await GET({} as any)
    const body = await response.json()

    expect(body.persistence.enabled).toBe(false)
    expect(body.persistence.mode).toBe('pglite')
    expect(body.persistence.unavailableReason).toBe(
      'backend-not-registered-by-module',
    )
  })
})
