import { describe, it, expect, vi } from 'vitest'

// Back the endpoint with a real in-memory store seeded with data whose
// distinctive values live in attributes (not in the streamed list projection),
// proving the endpoint reaches them.
vi.mock('$lib/server/traceStore', async () => {
  const { createInternalTraceStore } =
    await import('$lib/server/traceStore/core')
  const store = createInternalTraceStore(100, 100, 100, 600)
  store.ingestSpans([
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout' } },
        ],
      },
      scopeSpans: [
        {
          scope: {},
          spans: [
            {
              traceId: 'aaaa000000000000000000000000000000000001',
              spanId: 'bbbb000000000001',
              parentSpanId: '',
              name: 'POST /checkout',
              kind: 2,
              startTimeUnixNano: '1000000000000000000',
              endTimeUnixNano: '1000000000100000000',
              attributes: [
                { key: 'http.route', value: { stringValue: '/checkout' } },
              ],
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
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout' } },
        ],
      },
      scopeLogs: [
        {
          scope: {},
          logRecords: [
            {
              timeUnixNano: '1000000000060000000',
              severityNumber: 17,
              severityText: 'ERROR',
              body: { stringValue: 'payment failed' },
              attributes: [{ key: 'user.id', value: { stringValue: 'u-42' } }],
              traceId: 'aaaa000000000000000000000000000000000001',
            },
          ],
        },
      ],
    },
  ])
  return { traceStore: store }
})

import { GET } from './+server'

function get(qs: string) {
  return GET({ url: new URL(`http://localhost/api/search${qs}`) } as any)
}

describe('GET /api/search', () => {
  it('finds a log by an attribute value the list projection omits', async () => {
    const res = await get('?q=u-42')
    const body = await res.json()
    expect(body.logs).toHaveLength(1)
    expect(body.logs[0].matchedIn).toContain('attribute:user.id')
  })

  it('finds a trace by an attribute key', async () => {
    const res = await get('?q=http.route')
    const body = await res.json()
    expect(body.traces.length).toBeGreaterThan(0)
  })

  it('narrows to the requested kinds', async () => {
    const res = await get('?q=checkout&kinds=logs')
    const body = await res.json()
    expect(body.traces).toHaveLength(0)
    expect(body.logs.length).toBeGreaterThan(0)
  })

  it('supports service-only filtering with an empty query', async () => {
    const res = await get('?service=checkout')
    const body = await res.json()
    expect(body.logs.length).toBeGreaterThan(0)
    expect(body.traces.length).toBeGreaterThan(0)
  })

  it('returns empties for a bare request', async () => {
    const res = await get('')
    const body = await res.json()
    expect(body).toEqual({ traces: [], logs: [], metrics: [] })
  })
})
