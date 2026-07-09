import { describe, it, expect, vi } from 'vitest'

// Real in-memory store seeded with one of each signal, so the endpoint's
// pre-clear counts and post-clear empties can be asserted end-to-end.
vi.mock('$lib/server/traceStore', async () => {
  const { createInternalTraceStore } =
    await import('$lib/server/traceStore/core')
  const store = createInternalTraceStore(100, 100, 100, 600)
  store.ingestSpans([
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
      },
      scopeSpans: [
        {
          scope: {},
          spans: [
            {
              traceId: 'aaaa000000000000000000000000000000000001',
              spanId: 'bbbb000000000001',
              parentSpanId: '',
              name: 'root',
              kind: 2,
              startTimeUnixNano: '1000000000000000000',
              endTimeUnixNano: '1000000000100000000',
              attributes: [],
              events: [],
              links: [],
              status: { code: 0, message: '' },
            },
          ],
        },
      ],
    },
  ])
  store.ingestLogs([
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
      },
      scopeLogs: [
        {
          scope: {},
          logRecords: [
            {
              timeUnixNano: '1000000000060000000',
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: 'hello' },
              attributes: [],
            },
          ],
        },
      ],
    },
  ])
  store.ingestMetrics([
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'm',
              gauge: {
                dataPoints: [
                  { timeUnixNano: '1000000000000000000', asDouble: 1 },
                ],
              },
            },
          ],
        },
      ],
    },
  ])
  return { traceStore: store }
})

import { POST } from './+server'
import { traceStore } from '$lib/server/traceStore'

describe('POST /api/flush', () => {
  it('clears all buffers and reports the pre-clear counts', async () => {
    // Sanity: seeded state is non-empty.
    expect(traceStore.getTraceCount()).toBe(1)
    expect(traceStore.getLogCount()).toBe(1)
    expect(traceStore.getMetricCount()).toBe(1)

    const res = await POST({} as any)
    const body = await res.json()

    expect(body).toEqual({
      success: true,
      cleared: { traces: 1, logs: 1, metrics: 1 },
    })

    expect(traceStore.getTraceCount()).toBe(0)
    expect(traceStore.getLogCount()).toBe(0)
    expect(traceStore.getMetricCount()).toBe(0)
  })
})
