import { describe, it, expect, beforeEach } from 'vitest'
import { traceStore, resolveRootSpanName } from '$lib/server/traceStore'
import type { StoredTrace } from '$lib/types'
import simpleTrace from '../../../tests/fixtures/simple-trace.json'
import multiServiceTrace from '../../../tests/fixtures/multi-service-trace.json'
import errorTrace from '../../../tests/fixtures/error-trace.json'
import outOfOrderSpans from '../../../tests/fixtures/out-of-order-spans.json'

beforeEach(() => {
  traceStore.clear()
})

// ─── ingest + getTraceList ───────────────────────────────────────────────────

describe('traceStore.ingest / getTraceList', () => {
  it('stores a trace after ingestion', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const list = traceStore.getTraceList()
    expect(list).toHaveLength(1)
  })

  it('extracts service name from resource attributes', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.serviceName).toBe('frontend')
  })

  it('sets rootSpanName from the root span', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.rootSpanName).toBe('GET /')
  })

  it('computes a positive durationMs', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.durationMs).toBeGreaterThan(0)
  })

  it('sets hasError to false when no error spans', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.hasError).toBe(false)
  })

  it('sets hasError to true when a span has status.code === 2', () => {
    traceStore.ingest(errorTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.hasError).toBe(true)
  })

  it('counts spans correctly', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const [item] = traceStore.getTraceList()
    expect(item.spanCount).toBe(1)
  })

  it('ignores ingestion of non-array resourceSpans', () => {
    traceStore.ingest(null as any)
    expect(traceStore.getTraceList()).toHaveLength(0)
  })

  it('merges spans from multiple ingestions into the same trace', () => {
    const batches = outOfOrderSpans as any[]
    traceStore.ingest(batches[0].resourceSpans) // child first
    traceStore.ingest(batches[1].resourceSpans) // root second
    const list = traceStore.getTraceList()
    // Should be ONE trace, not two
    expect(list).toHaveLength(1)
    expect(list[0].spanCount).toBe(2)
  })

  it('updates rootSpanName when root span arrives late', () => {
    const batches = outOfOrderSpans as any[]
    // Ingest only the child batch first
    traceStore.ingest(batches[0].resourceSpans)
    let list = traceStore.getTraceList()
    // No true root yet — stored name might be the child's name or 'unknown'
    const traceId = list[0].traceId

    // Now ingest the root batch
    traceStore.ingest(batches[1].resourceSpans)
    list = traceStore.getTraceList()
    const item = list.find((t) => t.traceId === traceId)!
    expect(item.rootSpanName).toBe('GET /api/items')
  })

  it('handles multi-service traces without merging into one trace', () => {
    traceStore.ingest(multiServiceTrace.resourceSpans)
    const list = traceStore.getTraceList()
    // AAAABBBBCCCCDDDD… is one traceId, all spans belong to it
    expect(list).toHaveLength(1)
    expect(list[0].spanCount).toBe(3) // root + 2 backend spans
  })
})

// ─── getTrace ────────────────────────────────────────────────────────────────

describe('traceStore.getTrace', () => {
  it('returns undefined for unknown traceId', () => {
    expect(traceStore.getTrace('nonexistent')).toBeUndefined()
  })

  it('returns the StoredTrace after ingestion', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId)
    expect(trace).toBeDefined()
    expect(trace!.traceId).toBe(traceId)
  })

  it('returns spans as a Map', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId)!
    expect(trace.spans).toBeInstanceOf(Map)
    expect(trace.spans.size).toBe(1)
  })

  it('stores flattened attributes on spans', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
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
    // Insert 1001 unique traces
    for (let i = 0; i < 1001; i++) {
      const traceId = `TRACE${i.toString().padStart(28, '0')}`
      traceStore.ingest([
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
    // Total should be capped at 1000
    expect(traceStore.getTraceList(2000)).toHaveLength(1000)
  })
})

// ─── resolveRootSpanName ─────────────────────────────────────────────────────

describe('resolveRootSpanName', () => {
  it('returns the name of the true root span (no parentSpanId)', () => {
    traceStore.ingest(simpleTrace.resourceSpans)
    const traceId = traceStore.getTraceList()[0].traceId
    const trace = traceStore.getTrace(traceId) as StoredTrace
    expect(resolveRootSpanName(trace)).toBe('GET /')
  })

  it('falls back to earliest orphan when no true root exists', () => {
    // Ingest only the child batch (root span not included)
    const batches = outOfOrderSpans as any[]
    traceStore.ingest(batches[0].resourceSpans)
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
      spanCount: 0,
      hasError: false,
      spans: new Map(),
    }
    expect(resolveRootSpanName(emptyTrace)).toBe('unknown')
  })
})

// ─── subscribe / notify ──────────────────────────────────────────────────────

describe('traceStore.subscribe', () => {
  it('calls listener when spans are ingested', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    traceStore.ingest(simpleTrace.resourceSpans)
    unsub()
    expect(callCount).toBe(1)
  })

  it('does not call listener after unsubscribe', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    unsub()
    traceStore.ingest(simpleTrace.resourceSpans)
    expect(callCount).toBe(0)
  })

  it('calls listener when store is cleared', () => {
    let callCount = 0
    const unsub = traceStore.subscribe(() => {
      callCount++
    })
    traceStore.clear()
    unsub()
    expect(callCount).toBe(1)
  })
})
