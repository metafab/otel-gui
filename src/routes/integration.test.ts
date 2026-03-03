import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from './v1/traces/+server'
import {
  GET as getTraceList,
  DELETE as deleteTraces,
} from './api/traces/+server'
import { GET as getTrace } from './api/traces/[traceId]/+server'
import { GET as getServiceMap } from './api/service-map/+server'
import { GET as getMetrics } from './metrics/+server'
import { POST as postOtlpMetrics } from './v1/metrics/+server'
import { POST as postOtlpLogs } from './v1/logs/+server'
import { traceStore } from '$lib/server/traceStore'
import simpleTrace from '../../tests/fixtures/simple-trace.json'
import multiServiceTrace from '../../tests/fixtures/multi-service-trace.json'
import errorTrace from '../../tests/fixtures/error-trace.json'
import outOfOrderSpans from '../../tests/fixtures/out-of-order-spans.json'

// ─── helpers ────────────────────────────────────────────────────────────────

function makePostRequest(
  body: unknown,
  contentType = 'application/json',
): Request {
  return new Request('http://localhost:4318/v1/traces', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify(body),
  })
}

function makeUrl(path: string, params: Record<string, string> = {}): URL {
  const url = new URL(`http://localhost${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return url
}

beforeEach(() => {
  traceStore.clear()
})

// ─── POST /v1/traces ─────────────────────────────────────────────────────────

describe('POST /v1/traces', () => {
  it('returns 200 for valid JSON payload', async () => {
    const request = makePostRequest(simpleTrace)
    const response = await POST({ request } as any)
    expect(response.status).toBe(200)
  })

  it('ingests spans so they appear in the trace list', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const response = await getTraceList({ url: makeUrl('/api/traces') } as any)
    const traces = await response.json()

    expect(traces).toHaveLength(1)
    expect(traces[0].serviceName).toBe('frontend')
    expect(traces[0].rootSpanName).toBe('GET /')
  })

  it('returns 400 for unsupported content type', async () => {
    const request = new Request('http://localhost:4318/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    const response = await POST({ request } as any)
    expect(response.status).toBe(400)
  })

  it('returns 400 when resourceSpans is missing', async () => {
    const request = makePostRequest({ wrongKey: [] })
    const response = await POST({ request } as any)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/resourceSpans/i)
  })

  it('incremental ingestion: merges two batches of the same trace', async () => {
    const batches = outOfOrderSpans as any[]
    await POST({ request: makePostRequest(batches[0]) } as any)
    await POST({ request: makePostRequest(batches[1]) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()

    expect(traces).toHaveLength(1)
    expect(traces[0].spanCount).toBe(2)
    expect(traces[0].rootSpanName).toBe('GET /api/items')
  })

  it('ingests multi-service trace as one trace with all spans', async () => {
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()

    expect(traces).toHaveLength(1)
    expect(traces[0].spanCount).toBe(3)
  })

  it('sets hasError when a span has status.code 2', async () => {
    await POST({ request: makePostRequest(errorTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()

    expect(traces[0].hasError).toBe(true)
  })
})

// ─── GET /api/traces ─────────────────────────────────────────────────────────

describe('GET /api/traces', () => {
  it('returns empty array when no traces have been ingested', async () => {
    const response = await getTraceList({ url: makeUrl('/api/traces') } as any)
    const traces = await response.json()
    expect(traces).toEqual([])
  })

  it('returns all ingested traces', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(errorTrace) } as any)

    const response = await getTraceList({ url: makeUrl('/api/traces') } as any)
    const traces = await response.json()
    expect(traces).toHaveLength(2)
  })

  it('respects the limit query param', async () => {
    for (let i = 0; i < 5; i++) {
      const traceId = `LIMITTEST${i.toString().padStart(23, '0')}`
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

    const response = await getTraceList({
      url: makeUrl('/api/traces', { limit: '3' }),
    } as any)
    const traces = await response.json()
    expect(traces).toHaveLength(3)
  })

  it('sorts traces newest-first', async () => {
    traceStore.ingest([
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'old' } }],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: 'OLDTRACE0000000000000000000000AA',
                spanId: 'OLDSPAN000001',
                parentSpanId: '',
                name: 'old-op',
                kind: 1,
                startTimeUnixNano: '1000000000',
                endTimeUnixNano: '2000000000',
                attributes: [],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ])
    traceStore.ingest([
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'new' } }],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: 'NEWTRACE0000000000000000000000BB',
                spanId: 'NEWSPAN000001',
                parentSpanId: '',
                name: 'new-op',
                kind: 1,
                startTimeUnixNano: '9000000000',
                endTimeUnixNano: '9500000000',
                attributes: [],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ])

    const response = await getTraceList({ url: makeUrl('/api/traces') } as any)
    const traces = await response.json()
    expect(traces[0].serviceName).toBe('new')
    expect(traces[1].serviceName).toBe('old')
  })
})

// ─── DELETE /api/traces ──────────────────────────────────────────────────────

describe('DELETE /api/traces', () => {
  it('clears all traces and returns success', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const deleteResponse = await deleteTraces({} as any)
    const body = await deleteResponse.json()
    expect(body.success).toBe(true)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()
    expect(traces).toHaveLength(0)
  })
})

// ─── GET /api/traces/:traceId ─────────────────────────────────────────────────

describe('GET /api/traces/:traceId', () => {
  it('returns 404 for an unknown traceId', async () => {
    await expect(
      getTrace({ params: { traceId: 'nonexistent' } } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns trace detail with spans serialized as an object', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTrace({ params: { traceId } } as any)
    const trace = await response.json()

    expect(trace.traceId).toBe(traceId)
    expect(typeof trace.spans).toBe('object')
    expect(Object.keys(trace.spans)).toHaveLength(1)
  })

  it('includes resolved rootSpanName in the response', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTrace({ params: { traceId } } as any)
    const trace = await response.json()
    expect(trace.rootSpanName).toBe('GET /')
  })
})

// ─── GET /api/service-map ─────────────────────────────────────────────────────

describe('GET /api/service-map', () => {
  it('returns empty nodes and edges when no traces', async () => {
    const response = await getServiceMap({
      url: makeUrl('/api/service-map'),
    } as any)
    const data = await response.json()
    expect(data.nodes).toEqual([])
    expect(data.edges).toEqual([])
  })

  it('returns a node for each service', async () => {
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const response = await getServiceMap({
      url: makeUrl('/api/service-map'),
    } as any)
    const { nodes } = await response.json()

    const serviceNames = nodes.map((n: any) => n.serviceName)
    expect(serviceNames).toContain('frontend')
    expect(serviceNames).toContain('backend')
  })

  it('returns an edge between frontend and backend', async () => {
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const response = await getServiceMap({
      url: makeUrl('/api/service-map'),
    } as any)
    const { edges } = await response.json()

    const frontendToBackend = edges.find(
      (e: any) => e.source === 'frontend' && e.target === 'backend',
    )
    expect(frontendToBackend).toBeDefined()
    expect(frontendToBackend.callCount).toBeGreaterThan(0)
  })

  it('detects database external node from db.system attribute', async () => {
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const response = await getServiceMap({
      url: makeUrl('/api/service-map'),
    } as any)
    const { nodes } = await response.json()

    const dbNode = nodes.find((n: any) => n.nodeType === 'database')
    expect(dbNode).toBeDefined()
    expect(dbNode.serviceName).toBe('postgresql/orders')
  })

  it('scopes map to a single trace when traceId param is provided', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()
    const singleServiceTrace = traces.find(
      (t: any) => t.serviceName === 'frontend' && t.spanCount === 1,
    )

    const response = await getServiceMap({
      url: makeUrl('/api/service-map', { traceId: singleServiceTrace.traceId }),
    } as any)
    const { nodes } = await response.json()

    expect(nodes).toHaveLength(1)
    expect(nodes[0].serviceName).toBe('frontend')
  })
})

// ─── Unimplemented but known endpoints ───────────────────────────────────────

describe('Unimplemented endpoints', () => {
  it('returns 501 for GET /metrics', async () => {
    const response = await getMetrics({} as any)
    expect(response.status).toBe(501)

    const body = await response.json()
    expect(body.error).toMatch(/not implemented/i)
  })

  it('returns 501 for POST /v1/metrics', async () => {
    const request = makePostRequest({ resourceMetrics: [] })
    const response = await postOtlpMetrics({ request } as any)
    expect(response.status).toBe(501)

    const body = await response.json()
    expect(body.error).toMatch(/not implemented/i)
  })

  it('returns 501 for POST /v1/logs', async () => {
    const request = makePostRequest({ resourceLogs: [] })
    const response = await postOtlpLogs({ request } as any)
    expect(response.status).toBe(501)

    const body = await response.json()
    expect(body.error).toMatch(/not implemented/i)
  })
})
