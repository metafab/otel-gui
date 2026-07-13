import { describe, it, expect, beforeEach } from 'vitest'
import { traceStore } from '$lib/server/traceStore'
import { createInternalTraceStore } from '$lib/server/traceStore/core'
import {
  resolveRootServiceName,
  resolveRootSpanName,
  expoBoundsForBucket,
} from '@otel-gui/core'
import type { MetricPoint, StoredTrace } from '$lib/types'
import simpleTrace from '../../../tests/fixtures/simple-trace.json'
import simpleLog from '../../../tests/fixtures/simple-log.json'
import unlinkedLog from '../../../tests/fixtures/log-unlinked.json'
import multiServiceTrace from '../../../tests/fixtures/multi-service-trace.json'
import errorTrace from '../../../tests/fixtures/error-trace.json'
import outOfOrderSpans from '../../../tests/fixtures/out-of-order-spans.json'

beforeEach(() => {
  traceStore.clearTraces()
  traceStore.clearLogs()
  traceStore.clearMetrics()
})

// ─── ingest + getTraceList ───────────────────────────────────────────────────

describe('traceStore.ingestSpans / getTraceList', () => {
  it('stores a trace after ingestion', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const list = traceStore.getTraceList()
    expect(list).toHaveLength(1)
  })

  it('extracts service name from resource attributes', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.serviceName).toBe('frontend')
    expect(item.allServices).toEqual(['frontend'])
  })

  it('sets rootSpanName from the root span', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.rootSpanName).toBe('GET /')
  })

  it('computes a positive durationMs', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.durationMs).toBeGreaterThan(0)
  })

  it('sets hasError to false when no error spans', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.hasError).toBe(false)
  })

  it('sets hasError to true when a span has status.code === 2', () => {
    traceStore.ingestSpans(errorTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.hasError).toBe(true)
  })

  it('normalizes string enum kind ("SPAN_KIND_SERVER") to numeric 2', () => {
    traceStore.ingestSpans([
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
                kind: 'SPAN_KIND_SERVER',
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
    const trace = traceStore.getTrace(
      'aaaa000000000000000000000000000000000001',
    )!
    const span = Array.from(trace.spans.values())[0]
    expect(span.kind).toBe(2)
  })

  it('normalizes string enum status code ("STATUS_CODE_ERROR") to numeric 2 and sets hasError', () => {
    traceStore.ingestSpans([
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: 'aaaa000000000000000000000000000000000002',
                spanId: 'bbbb000000000002',
                parentSpanId: '',
                name: 'root',
                kind: 1,
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000000100000000',
                attributes: [],
                events: [],
                links: [],
                status: { code: 'STATUS_CODE_ERROR', message: 'boom' },
              },
            ],
          },
        ],
      },
    ])
    const trace = traceStore.getTrace(
      'aaaa000000000000000000000000000000000002',
    )!
    const span = Array.from(trace.spans.values())[0]
    expect(span.status.code).toBe(2)
    const [item] = traceStore.getTraceList()
    expect(item.hasError).toBe(true)
  })

  it('counts spans correctly', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.spanCount).toBe(1)
    expect(traceStore.getTraceCount()).toBe(1)
  })

  it('ignores ingestion of non-array resourceSpans', () => {
    traceStore.ingestSpans(null as any)
    expect(traceStore.getTraceList()).toHaveLength(0)
  })

  it('merges spans from multiple ingestions into the same trace', () => {
    const batches = outOfOrderSpans as any[]
    traceStore.ingestSpans(batches[0].resourceSpans) // child first
    traceStore.ingestSpans(batches[1].resourceSpans) // root second
    const list = traceStore.getTraceList()
    // Should be ONE trace, not two
    expect(list).toHaveLength(1)
    expect(list[0].spanCount).toBe(2)
  })

  it('updates rootSpanName when root span arrives late', () => {
    const batches = outOfOrderSpans as any[]
    // Ingest only the child batch first
    traceStore.ingestSpans(batches[0].resourceSpans)
    let list = traceStore.getTraceList()
    // No true root yet — stored name might be the child's name or 'unknown'
    const traceId = list[0].traceId

    // Now ingest the root batch
    traceStore.ingestSpans(batches[1].resourceSpans)
    list = traceStore.getTraceList()
    const item = list.find((t) => t.traceId === traceId)!
    expect(item.rootSpanName).toBe('GET /api/items')
  })

  it('handles multi-service traces without merging into one trace', () => {
    traceStore.ingestSpans(multiServiceTrace.resourceSpans)
    const list = traceStore.getTraceList()
    // AAAABBBBCCCCDDDD… is one traceId, all spans belong to it
    expect(list).toHaveLength(1)
    expect(list[0].spanCount).toBe(3) // root + 2 backend spans
    expect(list[0].allServices).toEqual(['backend', 'frontend'])
  })

  it('resolves serviceName from the root span resource even when another service arrives first', () => {
    traceStore.ingestSpans([...multiServiceTrace.resourceSpans].reverse())
    const [item] = traceStore.getTraceList()
    expect(item.serviceName).toBe('frontend')

    const trace = traceStore.getTrace(item.traceId)!
    expect(trace.serviceName).toBe('frontend')
  })
})

describe('traceStore.ingestLogs', () => {
  it('ignores ingestion of non-array resourceLogs', () => {
    traceStore.ingestLogs(null as any)
    expect(traceStore.getTraceList()).toHaveLength(0)
  })

  it('correlates logs into an existing trace by traceId', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    traceStore.ingestLogs(simpleLog.resourceLogs)

    const traceId = traceStore.getTraceList()[0].traceId
    const traceItem = traceStore
      .getTraceList()
      .find((item) => item.traceId === traceId)
    const logs = traceStore.getTraceLogs(traceId)

    expect(logs).toHaveLength(1)
    expect(traceItem?.logCount).toBe(1)

    const [log] = logs
    expect(log.traceId).toBe('5B8EFFF798038103D269B633813FC60C')
    expect(log.spanId).toBe('EEE19B7EC3C1B174')
    expect(log.body).toBe('database timeout')
  })

  it('creates a trace shell when logs arrive before spans', () => {
    traceStore.ingestLogs(simpleLog.resourceLogs)
    const [traceItem] = traceStore.getTraceList()
    expect(traceItem).toBeDefined()
    expect(traceItem.traceId).toBe('5B8EFFF798038103D269B633813FC60C')
    expect(traceItem.serviceName).toBe('frontend')
    expect(traceItem.allServices).toEqual(['frontend'])
    expect(traceItem.logCount).toBe(1)
  })

  it('sets hasError when log severity is error or above', () => {
    traceStore.ingestLogs(simpleLog.resourceLogs)
    const [traceItem] = traceStore.getTraceList()
    expect(traceItem.hasError).toBe(true)
  })

  it('ingests uncorrelated logs with null traceId/spanId into global log list', () => {
    traceStore.ingestLogs(unlinkedLog.resourceLogs)

    const logs = traceStore.getLogList(10)
    expect(logs).toHaveLength(3)
    expect(traceStore.getLogCount()).toBe(3)
    expect(logs.every((log) => log.traceId === null)).toBe(true)
    expect(logs.every((log) => log.spanId === null)).toBe(true)
    expect(logs.every((log) => log.serviceName === 'background-worker')).toBe(
      true,
    )
  })

  it('supports deleting selected global logs and clearing all logs', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    traceStore.ingestLogs(unlinkedLog.resourceLogs)
    traceStore.ingestLogs(simpleLog.resourceLogs)

    const correlatedTraceId = traceStore.getTraceList()[0].traceId
    expect(
      traceStore
        .getTraceList()
        .find((trace) => trace.traceId === correlatedTraceId)?.logCount,
    ).toBe(1)

    const initial = traceStore.getLogList(10)
    expect(initial).toHaveLength(4)

    const deletedCount = traceStore.deleteLogs([initial[0].id])
    expect(deletedCount).toBe(1)
    expect(traceStore.getLogList(10)).toHaveLength(3)

    const remainingCorrelated = traceStore
      .getLogList(10)
      .find((log) => log.traceId === correlatedTraceId)
    expect(remainingCorrelated).toBeDefined()

    if (remainingCorrelated) {
      traceStore.deleteLogs([remainingCorrelated.id])
    }

    expect(
      traceStore
        .getTraceList()
        .find((trace) => trace.traceId === correlatedTraceId)?.logCount,
    ).toBe(0)

    traceStore.clearLogs()
    expect(traceStore.getLogList(10)).toHaveLength(0)
  })

  it('prefers log.record.uid as the stored log id when present', () => {
    const payload = JSON.parse(JSON.stringify(simpleLog)) as any
    payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.push({
      key: 'log.record.uid',
      value: { stringValue: '01J6WX5W58Y0VZ0A8QK2SJQTR9' },
    })

    traceStore.ingestLogs(payload.resourceLogs)

    const [log] = traceStore.getLogList(10)
    expect(log).toBeDefined()
    expect(log.id).toBe('01J6WX5W58Y0VZ0A8QK2SJQTR9')
  })

  it('deduplicates logs that share the same log.record.uid', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)

    const traceId = traceStore.getTraceList()[0].traceId
    const payload = JSON.parse(JSON.stringify(simpleLog)) as any
    const base = payload.resourceLogs[0].scopeLogs[0].logRecords[0]

    payload.resourceLogs[0].scopeLogs[0].logRecords = [
      {
        ...base,
        traceId,
        timeUnixNano: '1544712660500000000',
        observedTimeUnixNano: '1544712660500000000',
        attributes: [
          ...(base.attributes || []),
          {
            key: 'log.record.uid',
            value: { stringValue: '01J6WX5W58Y0VZ0A8QK2SJQTR9' },
          },
        ],
      },
      {
        ...base,
        traceId,
        body: { stringValue: 'database timeout retry #2' },
        timeUnixNano: '1544712660600000000',
        observedTimeUnixNano: '1544712660600000000',
        attributes: [
          ...(base.attributes || []),
          {
            key: 'log.record.uid',
            value: { stringValue: '01J6WX5W58Y0VZ0A8QK2SJQTR9' },
          },
        ],
      },
    ]

    traceStore.ingestLogs(payload.resourceLogs)

    const logs = traceStore.getLogList(10)
    const traceItem = traceStore
      .getTraceList()
      .find((item) => item.traceId === traceId)

    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe('01J6WX5W58Y0VZ0A8QK2SJQTR9')
    expect(logs[0].body).toBe('database timeout retry #2')
    expect(traceItem?.logCount).toBe(1)
    expect(traceStore.getLogCount()).toBe(1)
  })
})

// ─── getTrace ────────────────────────────────────────────────────────────────

describe('traceStore.getTrace', () => {
  it('returns undefined for unknown traceId', () => {
    expect(traceStore.getTrace('nonexistent')).toBeUndefined()
  })

  it('returns the StoredTrace after ingestion', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId)
    expect(trace).toBeDefined()
    expect(trace!.traceId).toBe(traceId)
  })

  it('returns spans as a Map', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId)!
    expect(trace.spans).toBeInstanceOf(Map)
    expect(trace.spans.size).toBe(1)
  })

  it('stores flattened attributes on spans', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId)!
    const span = Array.from(trace.spans.values())[0]
    expect(span.attributes['http.method']).toBe('GET')
    expect(span.attributes['http.status_code']).toBe(200)
  })
})

// ─── FIFO eviction ───────────────────────────────────────────────────────────

describe('traceStore eviction', () => {
  it('evicts oldest traces when limit exceeded', () => {
    const limit = traceStore.maxTraces
    // Insert limit + 1 unique traces
    for (let i = 0; i < limit + 1; i++) {
      const traceId = `TRACE${i.toString().padStart(28, '0')}`
      traceStore.ingestSpans([
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'svc' } },
            ],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId,
                  spanId: `SPAN${i.toString().padStart(28, '0')}`,
                  parentSpanId: '',
                  name: `op-${i}`,
                  kind: 1,
                  startTimeUnixNano: `${1_000_000_000 + i}`,
                  endTimeUnixNano: `${2_000_000_000 + i}`,
                  attributes: [],
                  status: { code: 0 },
                },
              ],
            },
          ],
        },
      ])
    }
    expect(traceStore.getTraceList(limit + 1)).toHaveLength(limit)
  })
})

// ─── resolveRootSpanName ─────────────────────────────────────────────────────

describe('resolveRootSpanName', () => {
  it('returns the name of the true root span (no parentSpanId)', () => {
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId) as StoredTrace
    expect(resolveRootSpanName(trace)).toBe('GET /')
  })

  it('falls back to earliest orphan when no true root exists', () => {
    // Ingest only the child batch (root span not included)
    const batches = outOfOrderSpans as any[]
    traceStore.ingestSpans(batches[0].resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId) as StoredTrace
    // The only span is the child, and it becomes the orphan root
    expect(resolveRootSpanName(trace)).toBe('childOperation')
  })

  it('returns "unknown" for an empty trace', () => {
    const emptyTrace: StoredTrace = {
      traceId: 'empty',
      rootSpanName: '',
      serviceName: '',
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      updatedAt: 0,
      spanCount: 0,
      hasError: false,
      spans: new Map(),
    }
    expect(resolveRootSpanName(emptyTrace)).toBe('unknown')
  })

  it('returns the root span service name', () => {
    traceStore.ingestSpans([...multiServiceTrace.resourceSpans].reverse())
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId) as StoredTrace
    expect(resolveRootServiceName(trace)).toBe('frontend')
  })
})

// ─── subscribe / notify ──────────────────────────────────────────────────────

describe('traceStore.subscribe', () => {
  it('calls listener when spans are ingested', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    unsub()
    expect(callCount).toBe(1)
  })

  it('does not call listener after unsubscribe', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    unsub()
    traceStore.ingestSpans(simpleTrace.resourceSpans)
    expect(callCount).toBe(0)
  })

  it('calls listener when store is cleared', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    traceStore.clearTraces()
    unsub()
    expect(callCount).toBe(1)
  })
})

// ─── maxTraces ───────────────────────────────────────────────────────────────

describe('traceStore.maxTraces', () => {
  it('returns a positive integer', () => {
    expect(traceStore.maxTraces).toBeGreaterThan(0)
    expect(Number.isInteger(traceStore.maxTraces)).toBe(true)
  })

  it('defaults to 1000 when OTEL_GUI_MAX_TRACES is not set', () => {
    expect(traceStore.maxTraces).toBe(1000)
  })
})

// ─── metrics ─────────────────────────────────────────────────────────────────

// Builds a minimal OTLP resourceMetrics payload for one Gauge metric with the
// supplied data points (each [timeUnixNano, value, attributes?]).
function gaugePayload(
  serviceName: string,
  name: string,
  points: Array<[string, number, Record<string, string>?]>,
): any[] {
  return [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: 'unit-test' },
          metrics: [
            {
              name,
              unit: '1',
              gauge: {
                dataPoints: points.map(([timeUnixNano, value, attrs]) => ({
                  timeUnixNano,
                  asDouble: value,
                  attributes: Object.entries(attrs ?? {}).map(([k, v]) => ({
                    key: k,
                    value: { stringValue: v },
                  })),
                })),
              },
            },
          ],
        },
      ],
    },
  ]
}

describe('traceStore metrics — series fingerprinting', () => {
  it('splits data points into one series per distinct attribute set', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      gaugePayload('svc', 'm', [
        ['1700000000000000000', 1, { route: '/a' }],
        ['1700000001000000000', 2, { route: '/b' }],
        ['1700000002000000000', 3, { route: '/a' }],
      ]),
    )

    const [item] = store.getMetricList()
    expect(item.seriesCount).toBe(2)

    const detail = store.getMetric(item.id)
    const byRoute = new Map(
      Array.from(detail!.series.values()).map((s) => [
        s.attributes.route,
        s.points.length,
      ]),
    )
    expect(byRoute.get('/a')).toBe(2)
    expect(byRoute.get('/b')).toBe(1)
  })

  it('merges points with identical attributes into the same series', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      gaugePayload('svc', 'm', [['1700000000000000000', 1, { x: '1' }]]),
    )
    store.ingestMetrics(
      gaugePayload('svc', 'm', [['1700000001000000000', 2, { x: '1' }]]),
    )

    const [item] = store.getMetricList()
    expect(item.seriesCount).toBe(1)
    const detail = store.getMetric(item.id)
    expect(Array.from(detail!.series.values())[0].points).toHaveLength(2)
  })
})

describe('traceStore metrics — point-ring trimming', () => {
  it('trims a series to maxMetricPoints, dropping oldest first', () => {
    const maxMetricPoints = 5
    const store = createInternalTraceStore(10, 10, 100, maxMetricPoints)

    for (let i = 0; i < 12; i++) {
      store.ingestMetrics(
        gaugePayload('svc', 'm', [[`${1700000000000000000 + i}`, i]]),
      )
    }

    const [item] = store.getMetricList()
    const detail = store.getMetric(item.id)
    const points = Array.from(detail!.series.values())[0]
      .points as MetricPoint[]
    expect(points).toHaveLength(maxMetricPoints)
    // Oldest (0..6) dropped; newest five values (7..11) retained.
    expect(points.map((p) => p.v)).toEqual([7, 8, 9, 10, 11])
  })
})

describe('traceStore metrics — eviction at maxMetrics', () => {
  it('evicts oldest metrics once over the maxMetrics cap', () => {
    const maxMetrics = 3
    const store = createInternalTraceStore(10, 10, maxMetrics, 100)

    for (let i = 0; i < 5; i++) {
      store.ingestMetrics(
        gaugePayload('svc', `metric-${i}`, [['1700000000000000000', i]]),
      )
    }

    expect(store.getMetricCount()).toBe(maxMetrics)
    const names = store
      .getMetricList()
      .map((m) => m.name)
      .sort()
    // metric-0 and metric-1 (oldest) evicted.
    expect(names).toEqual(['metric-2', 'metric-3', 'metric-4'])
  })
})

describe('traceStore metrics — getMetricsSince cursor', () => {
  it('returns only metrics touched after the given sequence', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)

    store.ingestMetrics(
      gaugePayload('svc', 'first', [['1700000000000000000', 1]]),
    )
    const cursor = store.getMaxMetricSeq()

    store.ingestMetrics(
      gaugePayload('svc', 'second', [['1700000001000000000', 2]]),
    )

    const since = store.getMetricsSince(cursor)
    expect(since.map((m) => m.name)).toEqual(['second'])
    expect(store.getMetricsSince(store.getMaxMetricSeq())).toHaveLength(0)
  })
})

describe('traceStore metrics — removal-seq bump', () => {
  it('bumps removal seq on clearMetrics', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    const before = store.getMetricRemovalSeq()
    store.ingestMetrics(gaugePayload('svc', 'm', [['1700000000000000000', 1]]))
    expect(store.getMetricRemovalSeq()).toBe(before) // ingest does not bump
    store.clearMetrics()
    expect(store.getMetricRemovalSeq()).toBe(before + 1)
  })

  it('bumps removal seq on deleteMetrics when something is deleted', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(gaugePayload('svc', 'm', [['1700000000000000000', 1]]))
    const [item] = store.getMetricList()
    const before = store.getMetricRemovalSeq()

    expect(store.deleteMetrics(['does-not-exist'])).toBe(0)
    expect(store.getMetricRemovalSeq()).toBe(before) // no-op does not bump

    expect(store.deleteMetrics([item.id])).toBe(1)
    expect(store.getMetricRemovalSeq()).toBe(before + 1)
    expect(store.getMetricCount()).toBe(0)
  })
})

describe('traceStore.maxMetrics / maxMetricPoints', () => {
  it('exposes default metric limits on the shared store', () => {
    expect(traceStore.maxMetrics).toBe(1000)
    expect(traceStore.maxMetricPoints).toBe(600)
  })
})

// ─── Phase 2: histogram / exp-histogram / summary ingest ───────────────────────

// One-metric resourceMetrics payload whose single metric carries the supplied
// data oneof (e.g. { histogram: {...} }).
function metricPayload(
  serviceName: string,
  name: string,
  data: Record<string, unknown>,
): any[] {
  return [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: 'unit-test' },
          metrics: [{ name, unit: 'ms', ...data }],
        },
      ],
    },
  ]
}

// Cumulative monotonic Sum on one series at the given [nanos, value] points.
function cumulativeSumPayload(
  serviceName: string,
  name: string,
  points: Array<[string, number]>,
): any[] {
  return metricPayload(serviceName, name, {
    sum: {
      aggregationTemporality: 2,
      isMonotonic: true,
      dataPoints: points.map(([timeUnixNano, value]) => ({
        attributes: [],
        timeUnixNano,
        asDouble: value,
      })),
    },
  })
}

function deltaSumPayload(
  serviceName: string,
  name: string,
  points: Array<[string, number]>,
): any[] {
  return metricPayload(serviceName, name, {
    sum: {
      aggregationTemporality: 1,
      isMonotonic: true,
      dataPoints: points.map(([timeUnixNano, value]) => ({
        attributes: [],
        timeUnixNano,
        asDouble: value,
      })),
    },
  })
}

describe('traceStore metrics — histogram ingest', () => {
  it('stores histogram bucketCounts/bounds and projects them on detail', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      metricPayload('svc', 'lat', {
        histogram: {
          aggregationTemporality: 2,
          dataPoints: [
            {
              timeUnixNano: '1700000000000000000',
              count: '3',
              sum: 42,
              min: 1,
              max: 40,
              bucketCounts: ['1', '1', '1'],
              explicitBounds: [10, 50],
            },
          ],
        },
      }),
    )

    const [item] = store.getMetricList()
    expect(item.type).toBe('histogram')
    expect(item.sparkline).toEqual([3]) // count proxy, never crashes

    const detail = store.getMetricDetail(item.id)!
    const p: any = detail.series[0].points[0]
    expect(p.count).toBe(3)
    expect(p.sum).toBe(42)
    expect(p.min).toBe(1)
    expect(p.max).toBe(40)
    expect(p.bucketCounts).toEqual([1, 1, 1])
    expect(p.explicitBounds).toEqual([10, 50])
    expect(store.getMetric(item.id)!.temporality).toBe('cumulative')
  })
})

describe('traceStore metrics — exponential histogram ingest', () => {
  it('stores scale/zeroCount/positive/negative buckets', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      metricPayload('svc', 'expo', {
        exponentialHistogram: {
          aggregationTemporality: 2,
          dataPoints: [
            {
              timeUnixNano: '1700000000000000000',
              count: '6',
              sum: 100,
              scale: 3,
              zeroCount: '1',
              positive: { offset: 2, bucketCounts: ['2', '3'] },
              negative: { offset: 0, bucketCounts: [] },
            },
          ],
        },
      }),
    )

    const [item] = store.getMetricList()
    expect(item.type).toBe('exp_histogram')

    const detail = store.getMetricDetail(item.id)!
    const p: any = detail.series[0].points[0]
    expect(p.scale).toBe(3)
    expect(p.zeroCount).toBe(1)
    expect(p.positive).toEqual({ offset: 2, bucketCounts: [2, 3] })
    expect(p.negative).toEqual({ offset: 0, bucketCounts: [] })
  })
})

describe('traceStore metrics — summary ingest', () => {
  it('stores count/sum/quantileValues', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      metricPayload('svc', 'sum-q', {
        summary: {
          dataPoints: [
            {
              timeUnixNano: '1700000000000000000',
              count: '10',
              sum: 123,
              quantileValues: [
                { quantile: 0.5, value: 10 },
                { quantile: 0.99, value: 50 },
              ],
            },
          ],
        },
      }),
    )

    const [item] = store.getMetricList()
    expect(item.type).toBe('summary')

    const detail = store.getMetricDetail(item.id)!
    const p: any = detail.series[0].points[0]
    expect(p.count).toBe(10)
    expect(p.sum).toBe(123)
    expect(p.quantileValues).toEqual([
      { quantile: 0.5, value: 10 },
      { quantile: 0.99, value: 50 },
    ])
  })
})

// ─── Phase 2: server-side rate computation ─────────────────────────────────────

function firstSeriesPoints(store: any, id: string): any[] {
  return store.getMetricDetail(id)!.series[0].points
}

describe('traceStore metrics — rate (cumulative)', () => {
  it('computes per-second rate from monotonic increase; no rate on first point', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      cumulativeSumPayload('svc', 'c', [
        ['1700000000000000000', 5],
        ['1700000001000000000', 8], // +3 over 1s
        ['1700000003000000000', 18], // +10 over 2s
      ]),
    )
    const [item] = store.getMetricList()
    const pts = firstSeriesPoints(store, item.id)

    expect(pts[0]).toEqual({ t: pts[0].t, v: 5 })
    expect(pts[0].rate).toBeUndefined()
    expect(pts[1].v).toBe(8)
    expect(pts[1].rate).toBeCloseTo(3, 10)
    expect(pts[2].v).toBe(18)
    expect(pts[2].rate).toBeCloseTo(5, 10) // 10 / 2s
  })

  it('detects a counter reset and emits v_i/Δt instead of a negative rate', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      cumulativeSumPayload('svc', 'c', [
        ['1700000000000000000', 100],
        ['1700000001000000000', 7], // dropped → restart from 0 → 7/1s
      ]),
    )
    const [item] = store.getMetricList()
    const pts = firstSeriesPoints(store, item.id)
    expect(pts[1].v).toBe(7)
    expect(pts[1].rate).toBeCloseTo(7, 10)
    expect(pts[1].rate).toBeGreaterThanOrEqual(0)
  })

  it('handles irregular intervals (Δt varies per pair)', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      cumulativeSumPayload('svc', 'c', [
        ['1700000000000000000', 0],
        ['1700000000500000000', 5], // +5 over 0.5s = 10/s
        ['1700000004500000000', 9], // +4 over 4s = 1/s
      ]),
    )
    const [item] = store.getMetricList()
    const pts = firstSeriesPoints(store, item.id)
    expect(pts[1].rate).toBeCloseTo(10, 10)
    expect(pts[2].rate).toBeCloseTo(1, 10)
  })

  it('emits no rate for a single-point series', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      cumulativeSumPayload('svc', 'c', [['1700000000000000000', 5]]),
    )
    const [item] = store.getMetricList()
    const pts = firstSeriesPoints(store, item.id)
    expect(pts).toHaveLength(1)
    expect(pts[0].rate).toBeUndefined()
  })

  it('emits no rate when consecutive timestamps do not advance', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      cumulativeSumPayload('svc', 'c', [
        ['1700000000000000000', 5],
        ['1700000000000000000', 9], // same timestamp → Δt = 0
      ]),
    )
    const [item] = store.getMetricList()
    const pts = firstSeriesPoints(store, item.id)
    expect(pts[1].v).toBe(9)
    expect(pts[1].rate).toBeUndefined()
  })
})

describe('traceStore metrics — rate (delta)', () => {
  it('treats delta sums as per-interval: rate = v_i/Δt', () => {
    const store = createInternalTraceStore(10, 10, 100, 100)
    store.ingestMetrics(
      deltaSumPayload('svc', 'd', [
        ['1700000000000000000', 4],
        ['1700000002000000000', 6], // 6 over 2s = 3/s (NOT (6-4)/2)
      ]),
    )
    const [item] = store.getMetricList()
    expect(store.getMetric(item.id)!.temporality).toBe('delta')
    const pts = firstSeriesPoints(store, item.id)
    expect(pts[1].v).toBe(6)
    expect(pts[1].rate).toBeCloseTo(3, 10)
  })
})

describe('expoBoundsForBucket', () => {
  it('scale 0: base 2 → bucket i covers (2^i, 2^(i+1)]', () => {
    expect(expoBoundsForBucket(0, 0)).toEqual({ lower: 1, upper: 2 })
    expect(expoBoundsForBucket(0, 1)).toEqual({ lower: 2, upper: 4 })
    expect(expoBoundsForBucket(0, 3)).toEqual({ lower: 8, upper: 16 })
  })

  it('positive scale narrows buckets (scale 1 → base sqrt(2))', () => {
    const b = expoBoundsForBucket(1, 0)
    expect(b.lower).toBeCloseTo(1, 10)
    expect(b.upper).toBeCloseTo(Math.SQRT2, 10)
    // bucket 2 at scale 1 spans (2^(2/2), 2^(3/2)] = (2, 2.828...]
    const b2 = expoBoundsForBucket(1, 2)
    expect(b2.lower).toBeCloseTo(2, 10)
    expect(b2.upper).toBeCloseTo(Math.pow(2, 1.5), 10)
  })

  it('negative scale widens buckets (scale -1 → base 4)', () => {
    expect(expoBoundsForBucket(-1, 0)).toEqual({ lower: 1, upper: 4 })
    expect(expoBoundsForBucket(-1, 1)).toEqual({ lower: 4, upper: 16 })
  })
})
