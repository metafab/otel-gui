import { describe, it, expect } from 'vitest'
import {
  createServiceMapAggregate,
  accumulateSpan,
  projectServiceMap,
  clearServiceMapAggregate,
  forgetTraceSpans,
} from './serviceMap.js'
import type { StoredSpan } from './types.js'

// Minimal StoredSpan builder for aggregate tests.
function span(opts: {
  traceId: string
  spanId: string
  parentSpanId?: string
  service: string
  kind?: number
  error?: boolean
  start?: string
  end?: string
  attributes?: Record<string, any>
}): StoredSpan {
  return {
    traceId: opts.traceId,
    spanId: opts.spanId,
    parentSpanId: opts.parentSpanId ?? '',
    name: 'op',
    kind: opts.kind ?? 2,
    startTimeUnixNano: opts.start ?? '1000000',
    endTimeUnixNano: opts.end ?? '2000000',
    attributes: opts.attributes ?? {},
    events: [],
    links: [],
    status: { code: opts.error ? 2 : 1, message: '' },
    resource: { 'service.name': opts.service },
    scopeName: '',
    scopeVersion: '',
    scopeAttributes: {},
  }
}

function edge(data: ReturnType<typeof projectServiceMap>, s: string, t: string) {
  return data.edges.find((e) => e.source === s && e.target === t)
}

describe('service map cumulative aggregate', () => {
  it('resolves a cross-service edge when the child arrives BEFORE its parent', () => {
    const agg = createServiceMapAggregate()
    // Child (backend) first — parent (frontend) not ingested yet.
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'be', parentSpanId: 'fe', service: 'backend' }))
    let data = projectServiceMap(agg)
    // No edge yet — parent service unknown.
    expect(edge(data, 'frontend', 'backend')).toBeUndefined()
    // But the backend node already exists (nodes appear immediately).
    expect(data.nodes.find((n) => n.serviceName === 'backend')).toBeDefined()

    // Parent (frontend root) arrives — pending edge resolves.
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'fe', service: 'frontend' }))
    data = projectServiceMap(agg)
    const e = edge(data, 'frontend', 'backend')
    expect(e?.callCount).toBe(1)
  })

  it('builds the full frontend → backend → database chain in arrival order', () => {
    const agg = createServiceMapAggregate()
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'fe', service: 'frontend' }))
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'be', parentSpanId: 'fe', service: 'backend' }))
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'db', parentSpanId: 'be', service: 'database', kind: 3 }))
    const data = projectServiceMap(agg)
    expect(edge(data, 'frontend', 'backend')?.callCount).toBe(1)
    expect(edge(data, 'backend', 'database')?.callCount).toBe(1)
    expect(data.nodes).toHaveLength(3)
  })

  it('is idempotent — re-ingesting the same span never double-counts', () => {
    const agg = createServiceMapAggregate()
    const fe = span({ traceId: 't1', spanId: 'fe', service: 'frontend' })
    const be = span({ traceId: 't1', spanId: 'be', parentSpanId: 'fe', service: 'backend' })
    accumulateSpan(agg, fe)
    accumulateSpan(agg, be)
    accumulateSpan(agg, be) // duplicate
    accumulateSpan(agg, fe) // duplicate
    const data = projectServiceMap(agg)
    expect(edge(data, 'frontend', 'backend')?.callCount).toBe(1)
    expect(data.nodes.find((n) => n.serviceName === 'backend')?.spanCount).toBe(1)
  })

  it('accumulates counts cumulatively across many traces (never resets)', () => {
    const agg = createServiceMapAggregate()
    for (let i = 0; i < 5; i++) {
      accumulateSpan(agg, span({ traceId: `t${i}`, spanId: `fe${i}`, service: 'frontend' }))
      accumulateSpan(agg, span({
        traceId: `t${i}`,
        spanId: `be${i}`,
        parentSpanId: `fe${i}`,
        service: 'backend',
        error: i === 0,
      }))
    }
    const data = projectServiceMap(agg)
    const e = edge(data, 'frontend', 'backend')
    expect(e?.callCount).toBe(5)
    expect(e?.errorCount).toBe(1)
  })

  it('draws a CLIENT → external (db.system) attribute edge for a root client span', () => {
    const agg = createServiceMapAggregate()
    accumulateSpan(agg, span({
      traceId: 't1',
      spanId: 'c1',
      service: 'api',
      kind: 3,
      attributes: { 'db.system': 'postgresql', 'db.name': 'orders' },
    }))
    const data = projectServiceMap(agg)
    const ext = data.nodes.find((n) => n.serviceName === 'postgresql/orders')
    expect(ext?.nodeType).toBe('database')
    expect(edge(data, 'api', 'postgresql/orders')?.callCount).toBe(1)
  })

  it('clear empties the aggregate', () => {
    const agg = createServiceMapAggregate()
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'fe', service: 'frontend' }))
    clearServiceMapAggregate(agg)
    const data = projectServiceMap(agg)
    expect(data.nodes).toHaveLength(0)
    expect(data.edges).toHaveLength(0)
  })
})

describe('forgetTraceSpans (per-trace ledger pruning)', () => {
  it('prunes per-span ledgers but keeps the cumulative topology and counts', () => {
    const agg = createServiceMapAggregate()
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'fe', service: 'frontend' }))
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'be', parentSpanId: 'fe', service: 'backend' }))

    // Ledgers hold one entry per span while the trace is live.
    expect(agg.spanService.size).toBe(2)
    expect(agg.countedNodeSpans.size).toBe(2)
    expect(agg.resolvedEdgeSpans.size).toBe(2)

    forgetTraceSpans(agg, 't1', ['fe', 'be'])

    // Ledgers are released...
    expect(agg.spanService.size).toBe(0)
    expect(agg.countedNodeSpans.size).toBe(0)
    expect(agg.resolvedEdgeSpans.size).toBe(0)

    // ...but the map is unchanged: nodes, edge, and counts persist.
    const data = projectServiceMap(agg)
    expect(data.nodes.find((n) => n.serviceName === 'frontend')).toBeDefined()
    expect(data.nodes.find((n) => n.serviceName === 'backend')).toBeDefined()
    expect(edge(data, 'frontend', 'backend')?.callCount).toBe(1)
  })

  it('drops still-pending children of an evicted trace (never-arriving parent)', () => {
    const agg = createServiceMapAggregate()
    // Child arrives; its parent never does — it lingers in pendingChildren.
    accumulateSpan(agg, span({ traceId: 't1', spanId: 'be', parentSpanId: 'missing', service: 'backend' }))
    expect(agg.pendingChildren.size).toBe(1)

    forgetTraceSpans(agg, 't1', ['be'])
    expect(agg.pendingChildren.size).toBe(0)
  })

  it('keeps ledgers bounded to live traces across many evictions', () => {
    const agg = createServiceMapAggregate()
    // Simulate a ring buffer of 3 live traces over 100 ingested traces: each new
    // trace evicts the oldest, whose spans we then forget.
    const live: string[] = []
    for (let i = 0; i < 100; i++) {
      const traceId = `t${i}`
      accumulateSpan(agg, span({ traceId, spanId: 'fe', service: 'frontend' }))
      accumulateSpan(agg, span({ traceId, spanId: 'be', parentSpanId: 'fe', service: 'backend' }))
      live.push(traceId)
      if (live.length > 3) {
        forgetTraceSpans(agg, live.shift()!, ['fe', 'be'])
      }
    }

    // Ledgers track only the 3 live traces (2 spans each), not all 100 ingested.
    expect(agg.spanService.size).toBe(6)
    expect(agg.countedNodeSpans.size).toBe(6)
    expect(agg.resolvedEdgeSpans.size).toBe(6)

    // The cumulative map still reflects every trace ever seen.
    const data = projectServiceMap(agg)
    expect(edge(data, 'frontend', 'backend')?.callCount).toBe(100)
  })
})
