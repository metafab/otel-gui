import { describe, it, expect } from 'vitest'
import { createInternalTraceStore } from './core'
import type { InternalTraceStore } from './core'

// Build a store seeded with two services' worth of spans, logs, and metrics that
// carry distinctive strings in bodies, span names, status messages, events, and
// attributes — so each test can assert the deep scan reaches the right field.
function seed(): InternalTraceStore {
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
          scope: { name: 'checkout.scope' },
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
                { key: 'http.status_code', value: { intValue: '500' } },
              ],
              events: [
                {
                  timeUnixNano: '1000000000050000000',
                  name: 'exception',
                  attributes: [
                    {
                      key: 'exception.message',
                      value: { stringValue: 'connection timeout to payments' },
                    },
                  ],
                },
              ],
              links: [],
              status: { code: 2, message: 'upstream unavailable' },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'payments' } },
        ],
      },
      scopeSpans: [
        {
          scope: {},
          spans: [
            {
              traceId: 'aaaa000000000000000000000000000000000002',
              spanId: 'bbbb000000000002',
              parentSpanId: '',
              name: 'charge card',
              kind: 2,
              startTimeUnixNano: '2000000000000000000',
              endTimeUnixNano: '2000000000100000000',
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
              body: { stringValue: 'payment failed: connection timeout' },
              attributes: [{ key: 'user.id', value: { stringValue: 'u-42' } }],
              traceId: 'aaaa000000000000000000000000000000000001',
            },
            {
              timeUnixNano: '1000000000070000000',
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: 'checkout started' },
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
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout' } },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'http.server.duration',
              description: 'request latency',
              unit: 'ms',
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: '1000000000000000000',
                    asDouble: 12.5,
                    attributes: [
                      {
                        key: 'http.route',
                        value: { stringValue: '/checkout' },
                      },
                    ],
                  },
                ],
              },
            },
            {
              name: 'process.cpu.usage',
              description: '',
              unit: '1',
              gauge: {
                dataPoints: [
                  { timeUnixNano: '1000000000000000000', asDouble: 0.3 },
                ],
              },
            },
          ],
        },
      ],
    },
  ])

  return store
}

describe('searchLogs', () => {
  it('matches log bodies and reports the body breadcrumb', () => {
    const hits = seed().searchLogs({ query: 'connection timeout' })
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedIn).toContain('body')
  })

  it('matches attribute values with an attribute breadcrumb', () => {
    const hits = seed().searchLogs({ query: 'u-42' })
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedIn).toContain('attribute:user.id')
  })

  it('filters by service', () => {
    expect(seed().searchLogs({ service: 'payments' })).toHaveLength(0)
    expect(seed().searchLogs({ service: 'checkout' })).toHaveLength(2)
  })

  it('filters by minimum severity', () => {
    const hits = seed().searchLogs({ severityMin: 17 })
    expect(hits).toHaveLength(1)
    expect(hits[0].severityText).toBe('ERROR')
  })

  it('filters by traceId', () => {
    const hits = seed().searchLogs({
      traceId: 'aaaa000000000000000000000000000000000001',
    })
    expect(hits).toHaveLength(1)
  })
})

describe('searchTraces', () => {
  it('matches a span name and returns the matching span id', () => {
    const hits = seed().searchTraces({ query: 'charge card' })
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedIn).toContain('span.name')
    expect(hits[0].matchedSpanIds).toEqual(['bbbb000000000002'])
  })

  it('matches a span status message', () => {
    const hits = seed().searchTraces({ query: 'upstream unavailable' })
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedIn).toContain('span.status')
  })

  it('matches inside span event attributes', () => {
    const hits = seed().searchTraces({
      query: 'connection timeout to payments',
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedIn).toContain('event.attribute:exception.message')
  })

  it('matches an event name', () => {
    const hits = seed().searchTraces({ query: 'exception' })
    expect(hits.some((h) => h.matchedIn.includes('event:exception'))).toBe(true)
  })

  it('matches on an attribute key name', () => {
    const hits = seed().searchTraces({ query: 'http.route' })
    expect(hits.some((h) => h.matchedIn.includes('attribute:http.route'))).toBe(
      true,
    )
  })

  it('filters by service and error state', () => {
    expect(seed().searchTraces({ service: 'checkout' })).toHaveLength(1)
    expect(seed().searchTraces({ hasError: true })).toHaveLength(1)
    expect(seed().searchTraces({ hasError: false })).toHaveLength(1)
  })
})

describe('searchMetrics', () => {
  it('matches metric names', () => {
    const hits = seed().searchMetrics({ query: 'cpu' })
    expect(hits).toHaveLength(1)
    expect(hits[0].name).toBe('process.cpu.usage')
    expect(hits[0].matchedIn).toContain('name')
  })

  it('matches series attribute values', () => {
    const hits = seed().searchMetrics({ query: '/checkout' })
    expect(hits.some((h) => h.name === 'http.server.duration')).toBe(true)
  })

  it('matches the description', () => {
    const hits = seed().searchMetrics({ query: 'latency' })
    expect(hits[0].matchedIn).toContain('description')
  })
})

describe('searchAll', () => {
  it('returns hits grouped by signal', () => {
    const results = seed().searchAll({ query: 'checkout' })
    expect(results.traces.length).toBeGreaterThan(0)
    expect(results.logs.length).toBeGreaterThan(0)
    expect(results.metrics.length).toBeGreaterThan(0)
  })

  it('honours the kinds filter', () => {
    const results = seed().searchAll({ query: 'checkout', kinds: ['logs'] })
    expect(results.traces).toHaveLength(0)
    expect(results.metrics).toHaveLength(0)
    expect(results.logs.length).toBeGreaterThan(0)
  })
})

describe('listServices', () => {
  it('enumerates distinct services with per-signal counts', () => {
    const services = seed().listServices()
    const checkout = services.find((s) => s.name === 'checkout')!
    const payments = services.find((s) => s.name === 'payments')!
    expect(checkout.traceCount).toBe(1)
    expect(checkout.logCount).toBe(2)
    expect(checkout.metricCount).toBe(2)
    expect(payments.traceCount).toBe(1)
    expect(payments.logCount).toBe(0)
  })
})
