import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from './v1/traces/+server'
import {
  GET as getTraceList,
  DELETE as deleteTraces,
} from './api/traces/+server'
import { GET as getTrace } from './api/traces/[traceId]/+server'
import { GET as exportTrace } from './api/traces/[traceId]/export/+server'
import { POST as exportFilteredTraces } from './api/traces/export/+server'
import { POST as previewTraceImport } from './api/traces/import/preview/+server'
import { POST as importTraces } from './api/traces/import/+server'
import { GET as getTraceLogs } from './api/traces/[traceId]/logs/+server'
import { GET as getTraceLog } from './api/traces/[traceId]/logs/[logId]/+server'
import { GET as getServiceMap } from './api/service-map/+server'
import { GET as getMetrics } from './metrics/+server'
import { GET as getConfig } from './api/config/+server'
import { GET as getLogList, DELETE as deleteLogs } from './api/logs/+server'
import { GET as getLog } from './api/logs/[logId]/+server'
import { POST as postOtlpMetrics } from './v1/metrics/+server'
import {
  GET as getMetricList,
  DELETE as deleteMetrics,
} from './api/metrics/+server'
import { GET as getMetric } from './api/metrics/[metricId]/+server'
import { POST as postOtlpLogs } from './v1/logs/+server'
import { traceStore } from '$lib/server/traceStore'
import simpleTrace from '../../tests/fixtures/simple-trace.json'
import simpleLog from '../../tests/fixtures/simple-log.json'
import multiServiceTrace from '../../tests/fixtures/multi-service-trace.json'
import errorTrace from '../../tests/fixtures/error-trace.json'
import outOfOrderSpans from '../../tests/fixtures/out-of-order-spans.json'
import unlinkedLog from '../../tests/fixtures/log-unlinked.json'

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

function makeLogsPostRequest(
  body: unknown,
  contentType = 'application/json',
): Request {
  return new Request('http://localhost:4318/v1/logs', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify(body),
  })
}

function makeMetricsPostRequest(
  body: unknown,
  contentType = 'application/json',
): Request {
  return new Request('http://localhost:4318/v1/metrics', {
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

function makeJsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  traceStore.clearTraces()
  traceStore.clearLogs()
  traceStore.clearMetrics()
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

  it('returns 400 for malformed JSON payload', async () => {
    const request = new Request('http://localhost:4318/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"resourceSpans": [',
    })

    const response = await POST({ request } as any)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/malformed json/i)
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

  it.each(['application/x-protobuf', 'application/protobuf'])(
    'returns 200 with empty body and matching content-type for %s requests',
    async (contentType) => {
      const request = new Request('http://localhost:4318/v1/traces', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(0),
      })

      const response = await POST({ request } as any)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)

      const body = await response.arrayBuffer()
      expect(body.byteLength).toBe(0)
    },
  )

  it('returns 200 with {} body and application/json content-type for application/json requests', async () => {
    const request = new Request('http://localhost:4318/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] }),
    })

    const response = await POST({ request } as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({})
  })
})

describe('POST /v1/logs', () => {
  it('returns 200 for valid JSON payload', async () => {
    const request = makeLogsPostRequest(simpleLog)
    const response = await postOtlpLogs({ request } as any)
    expect(response.status).toBe(200)
  })

  it('returns 400 when resourceLogs is missing', async () => {
    const request = makeLogsPostRequest({ wrongKey: [] })
    const response = await postOtlpLogs({ request } as any)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/resourceLogs/i)
  })

  it('returns 400 for unsupported content type', async () => {
    const request = new Request('http://localhost:4318/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    const response = await postOtlpLogs({ request } as any)
    expect(response.status).toBe(400)
  })

  it.each(['application/x-protobuf', 'application/protobuf'])(
    'returns 200 with empty body and matching content-type for %s log requests',
    async (contentType) => {
      const request = new Request('http://localhost:4318/v1/logs', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(0),
      })

      const response = await postOtlpLogs({ request } as any)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)

      const body = await response.arrayBuffer()
      expect(body.byteLength).toBe(0)
    },
  )

  it('returns 200 with {} body and application/json content-type for application/json log requests', async () => {
    const request = new Request('http://localhost:4318/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceLogs: [] }),
    })

    const response = await postOtlpLogs({ request } as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({})
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

    const response = await getTraceList({
      url: makeUrl('/api/traces', { limit: '3' }),
    } as any)
    const traces = await response.json()
    expect(traces).toHaveLength(3)
  })

  it('sorts traces newest-first', async () => {
    traceStore.ingestSpans([
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
    traceStore.ingestSpans([
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

  it('deletes only selected trace IDs when traceIds are provided', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(errorTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()
    expect(traces).toHaveLength(2)

    const traceToDelete = traces.find(
      (trace: { hasError: boolean }) => trace.hasError,
    )
    expect(traceToDelete).toBeDefined()

    const deleteRequest = new Request('http://localhost/api/traces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceIds: [traceToDelete.traceId] }),
    })

    const deleteResponse = await deleteTraces({ request: deleteRequest } as any)
    const body = await deleteResponse.json()

    expect(deleteResponse.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.mode).toBe('selected')
    expect(body.deletedCount).toBe(1)

    const afterDeleteResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const remainingTraces = await afterDeleteResponse.json()

    expect(remainingTraces).toHaveLength(1)
    expect(remainingTraces[0].traceId).not.toBe(traceToDelete.traceId)
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
    expect(trace.logCount).toBe(0)
  })

  it('returns trace detail with correlated logCount', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTrace({ params: { traceId } } as any)
    const trace = await response.json()

    expect(trace.logCount).toBe(1)
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

describe('GET /api/traces/:traceId/export', () => {
  it('exports a trace as a downloadable otel-gui JSON envelope', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await exportTrace({ params: { traceId } } as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(traceId)
    expect(payload.format).toBe('otel-gui-trace-export')
    expect(payload.traceCount).toBe(1)
    expect(payload.spanCount).toBe(1)
    expect(payload.traces).toHaveLength(1)
    expect(payload.traces[0].traceId).toBe(traceId)
    expect(payload.traces[0].resourceSpans).toHaveLength(1)
  })

  it('exports span kind and status code as ProtoJSON string enum names', async () => {
    await POST({ request: makePostRequest(errorTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await exportTrace({ params: { traceId } } as any)
    const payload = await response.json()

    const spans = payload.traces[0].resourceSpans.flatMap((rs: any) =>
      rs.scopeSpans.flatMap((ss: any) => ss.spans),
    )
    for (const span of spans) {
      expect(typeof span.kind).toBe('string')
      expect(span.kind).toMatch(/^SPAN_KIND_/)
      expect(typeof span.status.code).toBe('string')
      expect(span.status.code).toMatch(/^STATUS_CODE_/)
    }
  })

  it('round-trips string enum kinds through export then re-ingest', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const exportResponse = await exportTrace({ params: { traceId } } as any)
    const exportedPayload = await exportResponse.json()

    traceStore.clearTraces()
    await POST({
      request: makePostRequest(exportedPayload.traces[0]),
    } as any)

    const reimportedList = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const reimported = await reimportedList.json()
    expect(reimported).toHaveLength(1)
    expect(reimported[0].traceId).toBe(traceId)
    expect(reimported[0].spanCount).toBe(1)
  })
})

describe('POST /api/traces/export', () => {
  it('exports only the requested trace IDs in one envelope', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(errorTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()
    expect(traces).toHaveLength(2)

    const targetTraceId = traces.find(
      (trace: { hasError: boolean }) => trace.hasError,
    )?.traceId
    expect(targetTraceId).toBeDefined()

    const response = await exportFilteredTraces({
      request: makeJsonRequest('/api/traces/export', {
        traceIds: [targetTraceId],
      }),
    } as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.traceCount).toBe(1)
    expect(payload.traces).toHaveLength(1)
    expect(payload.traces[0].traceId).toBe(targetTraceId)
  })

  it('returns 400 when traceIds payload is missing or invalid', async () => {
    const response = await exportFilteredTraces({
      request: makeJsonRequest('/api/traces/export', {}),
    } as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/traceIds/i)
  })
})

describe('POST /api/traces/import/preview', () => {
  it('previews otel-gui export metadata before import', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()
    const exportResponse = await exportTrace({ params: { traceId } } as any)
    const exportedPayload = await exportResponse.json()

    traceStore.clearTraces()

    const previewResponse = await previewTraceImport({
      request: makeJsonRequest('/api/traces/import/preview', {
        fileName: 'trace.json',
        content: JSON.stringify(exportedPayload),
      }),
    } as any)
    const preview = await previewResponse.json()

    expect(previewResponse.status).toBe(200)
    expect(preview.format).toBe('otel-gui-trace-export')
    expect(preview.fileName).toBe('trace.json')
    expect(preview.traceCount).toBe(1)
    expect(preview.spanCount).toBe(1)
    expect(preview.services).toEqual(['frontend'])
  })

  it('returns 400 for malformed JSON content', async () => {
    const previewResponse = await previewTraceImport({
      request: makeJsonRequest('/api/traces/import/preview', {
        fileName: 'bad.json',
        content: '{',
      }),
    } as any)

    const preview = await previewResponse.json()
    expect(previewResponse.status).toBe(400)
    expect(preview.error).toMatch(/malformed json/i)
  })

  it('uses envelope traceCount metadata in preview', async () => {
    const syntheticEnvelope = {
      format: 'otel-gui-trace-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      traceCount: 2,
      spanCount: 1,
      traces: [
        {
          traceId: 'SINGLETRACE0000000000000000000001',
          resourceSpans: (simpleTrace as any).resourceSpans,
        },
      ],
    }

    const previewResponse = await previewTraceImport({
      request: makeJsonRequest('/api/traces/import/preview', {
        fileName: 'multi-trace-meta.json',
        content: JSON.stringify(syntheticEnvelope),
      }),
    } as any)
    const preview = await previewResponse.json()

    expect(previewResponse.status).toBe(200)
    expect(preview.traceCount).toBe(2)
    expect(preview.warnings.join(' ')).toMatch(/declares 2 trace/i)
  })

  it('explains envelope traces without spans instead of traceId mismatch warning', async () => {
    const envelopeWithEmptyTrace = {
      format: 'otel-gui-trace-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      traceCount: 2,
      spanCount: 1,
      traces: [
        {
          traceId: 'TRACE_WITH_SPAN',
          resourceSpans: (simpleTrace as any).resourceSpans,
        },
        {
          traceId: 'TRACE_WITHOUT_SPANS',
          resourceSpans: [],
        },
      ],
    }

    const previewResponse = await previewTraceImport({
      request: makeJsonRequest('/api/traces/import/preview', {
        fileName: 'envelope-with-empty-trace.json',
        content: JSON.stringify(envelopeWithEmptyTrace),
      }),
    } as any)
    const preview = await previewResponse.json()

    expect(previewResponse.status).toBe(200)
    expect(preview.traceCount).toBe(2)
    expect(preview.warnings.join(' ')).toMatch(/without spans/i)
    expect(preview.warnings.join(' ')).not.toMatch(/span analysis found/i)
  })
})

describe('POST /api/traces/import', () => {
  it('imports an exported trace and restores it in the trace list', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()
    const exportResponse = await exportTrace({ params: { traceId } } as any)
    const exportedPayload = await exportResponse.json()

    traceStore.clearTraces()

    const importResponse = await importTraces({
      request: makeJsonRequest('/api/traces/import', {
        fileName: 'trace.json',
        content: JSON.stringify(exportedPayload),
      }),
    } as any)
    const imported = await importResponse.json()

    expect(importResponse.status).toBe(200)
    expect(imported.importedTraceCount).toBe(1)
    expect(imported.importedSpanCount).toBe(1)

    const restoredListResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const restoredTraces = await restoredListResponse.json()

    expect(restoredTraces).toHaveLength(1)
    expect(restoredTraces[0].traceId).toBe(traceId)
    expect(restoredTraces[0].rootSpanName).toBe('GET /')
  })

  it('imports raw OTLP JSON payloads directly', async () => {
    const importResponse = await importTraces({
      request: makeJsonRequest('/api/traces/import', {
        fileName: 'simple-trace.json',
        content: JSON.stringify(simpleTrace),
      }),
    } as any)
    const imported = await importResponse.json()

    expect(importResponse.status).toBe(200)
    expect(imported.importedTraceCount).toBe(1)
    expect(imported.importedSpanCount).toBe(1)
  })

  it('imports a multi-trace export envelope and restores both traces', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(errorTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await listResponse.json()
    expect(traces).toHaveLength(2)

    const exportedTraces = await Promise.all(
      traces.map(async (trace: { traceId: string }) => {
        const response = await exportTrace({
          params: { traceId: trace.traceId },
        } as any)
        expect(response.status).toBe(200)
        return response.json()
      }),
    )

    const combinedEnvelope = {
      format: 'otel-gui-trace-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      traceCount: exportedTraces.reduce(
        (total, exported) => total + exported.traceCount,
        0,
      ),
      spanCount: exportedTraces.reduce(
        (total, exported) => total + exported.spanCount,
        0,
      ),
      traces: exportedTraces.flatMap((exported) => exported.traces),
    }

    traceStore.clearTraces()

    const importResponse = await importTraces({
      request: makeJsonRequest('/api/traces/import', {
        fileName: 'multi-trace-export.json',
        content: JSON.stringify(combinedEnvelope),
      }),
    } as any)
    const imported = await importResponse.json()

    expect(importResponse.status).toBe(200)
    expect(imported.importedTraceCount).toBe(2)

    const restoredListResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const restoredTraces = await restoredListResponse.json()

    expect(restoredTraces).toHaveLength(2)

    const restoredIds = restoredTraces.map(
      (trace: { traceId: string }) => trace.traceId,
    )
    for (const trace of traces) {
      expect(restoredIds).toContain(trace.traceId)
    }
  })
})

describe('GET /api/traces/:traceId/logs', () => {
  it('returns 404 for unknown traceId', async () => {
    await expect(
      getTraceLogs({
        params: { traceId: 'nonexistent' },
        url: makeUrl('/api/traces/nonexistent/logs'),
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns empty array when trace has no correlated logs', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTraceLogs({
      params: { traceId },
      url: makeUrl(`/api/traces/${traceId}/logs`),
    } as any)
    const logs = await response.json()

    expect(logs).toEqual([])
  })

  it('returns correlated logs for a trace', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTraceLogs({
      params: { traceId },
      url: makeUrl(`/api/traces/${traceId}/logs`),
    } as any)
    const logs = await response.json()

    expect(logs).toHaveLength(1)
    expect(logs[0].traceId).toBe(traceId)
    expect(logs[0].severityText).toBe('ERROR')
  })

  it('supports spanId filtering', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const response = await getTraceLogs({
      params: { traceId },
      url: makeUrl(`/api/traces/${traceId}/logs`, { spanId: 'unknown-span' }),
    } as any)
    const logs = await response.json()

    expect(logs).toEqual([])
  })

  it('applies spanId filtering before limit', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const payload = JSON.parse(JSON.stringify(simpleLog)) as any
    const base = payload.resourceLogs[0].scopeLogs[0].logRecords[0]
    payload.resourceLogs[0].scopeLogs[0].logRecords = [
      {
        ...base,
        traceId,
        spanId: 'target-span',
        timeUnixNano: '1544712660000000000',
        observedTimeUnixNano: '1544712660000000000',
      },
      {
        ...base,
        traceId,
        spanId: 'other-span',
        timeUnixNano: '1544712662000000000',
        observedTimeUnixNano: '1544712662000000000',
      },
      {
        ...base,
        traceId,
        spanId: 'other-span',
        timeUnixNano: '1544712663000000000',
        observedTimeUnixNano: '1544712663000000000',
      },
    ]

    await postOtlpLogs({ request: makeLogsPostRequest(payload) } as any)

    const response = await getTraceLogs({
      params: { traceId },
      url: makeUrl(`/api/traces/${traceId}/logs`, {
        spanId: 'target-span',
        limit: '1',
      }),
    } as any)
    const logs = await response.json()

    expect(logs).toHaveLength(1)
    expect(logs[0].spanId).toBe('target-span')
  })
})

describe('GET /api/traces/:traceId/logs/:logId', () => {
  it('returns 404 for unknown traceId', async () => {
    await expect(
      getTraceLog({
        params: { traceId: 'nonexistent', logId: 'abc' },
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns 404 for unknown logId in an existing trace', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    await expect(
      getTraceLog({
        params: { traceId, logId: 'missing' },
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns 404 when logId points to an unlinked/global log', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(unlinkedLog) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const logsResponse = await getLogList({
      url: makeUrl('/api/logs'),
    } as any)
    const logs = await logsResponse.json()
    const unlinked = logs.find(
      (log: { traceId: string | null }) => !log.traceId,
    )

    expect(unlinked).toBeDefined()

    await expect(
      getTraceLog({
        params: { traceId, logId: unlinked.id },
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns 404 when logId belongs to a different trace', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await POST({ request: makePostRequest(multiServiceTrace) } as any)

    const traceListResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await traceListResponse.json()

    expect(traces.length).toBeGreaterThanOrEqual(2)
    const firstTraceId = traces[0].traceId
    const secondTraceId = traces[1].traceId

    const foreignLogPayload = JSON.parse(JSON.stringify(simpleLog)) as any
    foreignLogPayload.resourceLogs[0].scopeLogs[0].logRecords[0].traceId =
      secondTraceId
    foreignLogPayload.resourceLogs[0].scopeLogs[0].logRecords[0].spanId = ''

    await postOtlpLogs({
      request: makeLogsPostRequest(foreignLogPayload),
    } as any)

    const secondTraceLogsResponse = await getTraceLogs({
      params: { traceId: secondTraceId },
      url: makeUrl(`/api/traces/${secondTraceId}/logs`),
    } as any)
    const secondTraceLogs = await secondTraceLogsResponse.json()

    expect(secondTraceLogs.length).toBeGreaterThan(0)

    await expect(
      getTraceLog({
        params: { traceId: firstTraceId, logId: secondTraceLogs[0].id },
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns full log detail payload', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const listResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const [{ traceId }] = await listResponse.json()

    const logsResponse = await getTraceLogs({
      params: { traceId },
      url: makeUrl(`/api/traces/${traceId}/logs`),
    } as any)
    const logs = await logsResponse.json()

    const detailResponse = await getTraceLog({
      params: { traceId, logId: logs[0].id },
    } as any)
    const detail = await detailResponse.json()

    expect(detail.id).toBe(logs[0].id)
    expect(detail.traceId).toBe(traceId)
    expect(detail.attributes['retry_count']).toBe(2)
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
})

// ─── POST /v1/metrics ─────────────────────────────────────────────────────────

function gaugeMetricPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'cart-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'process.memory.usage',
                description: 'Resident memory',
                unit: 'By',
                gauge: {
                  dataPoints: [
                    {
                      attributes: [
                        { key: 'state', value: { stringValue: 'used' } },
                      ],
                      timeUnixNano: '1700000000000000000',
                      asInt: '1048576',
                    },
                    {
                      attributes: [
                        { key: 'state', value: { stringValue: 'used' } },
                      ],
                      timeUnixNano: '1700000001000000000',
                      asInt: '2097152',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

function sumMetricPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'cart-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'http.server.request.count',
                description: 'Request count',
                unit: '1',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      attributes: [
                        { key: 'route', value: { stringValue: '/a' } },
                      ],
                      timeUnixNano: '1700000000000000000',
                      asDouble: 5,
                    },
                    {
                      attributes: [
                        { key: 'route', value: { stringValue: '/b' } },
                      ],
                      timeUnixNano: '1700000000000000000',
                      asDouble: 9,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

function histogramMetricPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'hist-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'http.server.duration',
                description: 'Latency distribution',
                unit: 'ms',
                histogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      count: '3',
                      sum: 42,
                      bucketCounts: ['1', '1', '1'],
                      explicitBounds: [10, 50],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

function expHistogramMetricPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'expo-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'rpc.duration',
                description: 'Exponential latency',
                unit: 'ms',
                exponentialHistogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      count: '7',
                      sum: 100,
                      scale: 2,
                      zeroCount: '1',
                      positive: { offset: 0, bucketCounts: ['2', '3', '1'] },
                      negative: { offset: 0, bucketCounts: [] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

function summaryMetricPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'summary-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'rpc.client.duration',
                description: 'Legacy summary',
                unit: 'ms',
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
              },
            ],
          },
        ],
      },
    ],
  }
}

// Cumulative monotonic Sum across two timestamps 1s apart (5 -> 8) on one
// series, used to exercise the server-side rate projection on the wire.
function cumulativeSumPayload(): any {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'rate-service' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'http.requests',
                unit: '1',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      attributes: [],
                      timeUnixNano: '1700000000000000000',
                      asDouble: 5,
                    },
                    {
                      attributes: [],
                      timeUnixNano: '1700000001000000000',
                      asDouble: 8,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('POST /v1/metrics', () => {
  it('returns 200 for valid JSON payload', async () => {
    const response = await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)
    expect(response.status).toBe(200)
  })

  it('returns 400 when resourceMetrics is missing', async () => {
    const response = await postOtlpMetrics({
      request: makeMetricsPostRequest({ wrongKey: [] }),
    } as any)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/resourceMetrics/i)
  })

  it('returns 400 for unsupported content type', async () => {
    const request = new Request('http://localhost:4318/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    const response = await postOtlpMetrics({ request } as any)
    expect(response.status).toBe(400)
  })

  it('ingests a Gauge metric so it appears in GET /api/metrics', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)

    const response = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const metrics = await response.json()

    expect(metrics).toHaveLength(1)
    expect(metrics[0].name).toBe('process.memory.usage')
    expect(metrics[0].type).toBe('gauge')
    expect(metrics[0].serviceName).toBe('cart-service')
    expect(metrics[0].unit).toBe('By')
    expect(metrics[0].seriesCount).toBe(1)
    expect(metrics[0].sparkline).toEqual([1048576, 2097152])
  })

  it('ingests a Sum metric with one series per attribute set', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(sumMetricPayload()),
    } as any)

    const response = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const metrics = await response.json()

    expect(metrics).toHaveLength(1)
    expect(metrics[0].name).toBe('http.server.request.count')
    expect(metrics[0].type).toBe('sum')
    expect(metrics[0].seriesCount).toBe(2)
  })

  it('ingests a histogram metric (Phase 2) and lists it', async () => {
    const response = await postOtlpMetrics({
      request: makeMetricsPostRequest(histogramMetricPayload()),
    } as any)
    expect(response.status).toBe(200)

    const listResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const metrics = await listResponse.json()
    expect(metrics).toHaveLength(1)
    expect(metrics[0].name).toBe('http.server.duration')
    expect(metrics[0].type).toBe('histogram')
    // Sparkline of a histogram is a count proxy (never crashes on bucket points).
    expect(metrics[0].sparkline).toEqual([3])
  })

  it.each(['application/x-protobuf', 'application/protobuf'])(
    'returns 200 with empty body and matching content-type for %s metric requests',
    async (contentType) => {
      const request = new Request('http://localhost:4318/v1/metrics', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(0),
      })

      const response = await postOtlpMetrics({ request } as any)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)

      const body = await response.arrayBuffer()
      expect(body.byteLength).toBe(0)
    },
  )

  it('ingests Gauge + Sum via protobuf and round-trips through GET /api/metrics', async () => {
    const protobuf = await import('protobufjs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const protoRoot = join(here, '..', '..', 'proto')
    const root = new protobuf.default.Root()
    root.resolvePath = (_origin: string, target: string) => {
      if (target.startsWith('opentelemetry/')) return join(protoRoot, target)
      return target
    }
    await root.load(
      'opentelemetry/proto/collector/metrics/v1/metrics_service.proto',
    )
    const ExportMetricsServiceRequest = root.lookupType(
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest',
    )

    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: 'pb-service' },
              },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: 'pb-scope' },
              metrics: [
                {
                  name: 'pb.gauge',
                  unit: '1',
                  gauge: {
                    dataPoints: [
                      { timeUnixNano: 1700000000000000000, asDouble: 3.5 },
                    ],
                  },
                },
                {
                  name: 'pb.counter',
                  unit: '1',
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [
                      { timeUnixNano: 1700000000000000000, asInt: 7 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }

    const buffer = ExportMetricsServiceRequest.encode(
      ExportMetricsServiceRequest.fromObject(payload),
    ).finish()

    const request = new Request('http://localhost:4318/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array(buffer),
    })

    const response = await postOtlpMetrics({ request } as any)
    expect(response.status).toBe(200)

    const listResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const metrics = await listResponse.json()
    const names = metrics.map((m: any) => m.name).sort()
    expect(names).toEqual(['pb.counter', 'pb.gauge'])
  })
})

// ─── GET /api/metrics ─────────────────────────────────────────────────────────

describe('GET /api/metrics', () => {
  it('returns empty array when no metrics ingested', async () => {
    const response = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    expect(await response.json()).toEqual([])
  })

  it('respects the limit query param', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)
    await postOtlpMetrics({
      request: makeMetricsPostRequest(sumMetricPayload()),
    } as any)

    const response = await getMetricList({
      url: makeUrl('/api/metrics', { limit: '1' }),
    } as any)
    const metrics = await response.json()
    expect(metrics).toHaveLength(1)
  })
})

// ─── GET /api/metrics/:metricId ───────────────────────────────────────────────

describe('GET /api/metrics/:metricId', () => {
  it('returns 404 for unknown metricId', async () => {
    await expect(
      getMetric({ params: { metricId: 'nope' } } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns full series + points for an ingested metric', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)

    const listResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const [{ id }] = await listResponse.json()

    const response = await getMetric({ params: { metricId: id } } as any)
    const detail = await response.json()

    expect(detail.id).toBe(id)
    expect(detail.name).toBe('process.memory.usage')
    expect(detail.type).toBe('gauge')
    expect(Array.isArray(detail.series)).toBe(true)
    expect(detail.series).toHaveLength(1)
    expect(detail.series[0].points).toHaveLength(2)
    expect(detail.series[0].points[0].v).toBe(1048576)
    // Gauge points carry no rate.
    expect(detail.series[0].points[0].rate).toBeUndefined()
    expect(detail.series[0].points[1].rate).toBeUndefined()
  })

  it('attaches a per-second rate to cumulative Sum points (raw kept)', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(cumulativeSumPayload()),
    } as any)

    const [{ id }] = await (
      await getMetricList({ url: makeUrl('/api/metrics') } as any)
    ).json()
    const detail = await (
      await getMetric({ params: { metricId: id } } as any)
    ).json()

    const pts = detail.series[0].points
    expect(pts).toHaveLength(2)
    // First point of a series has no predecessor → no rate, raw retained.
    expect(pts[0]).toMatchObject({ v: 5 })
    expect(pts[0].rate).toBeUndefined()
    // (8 - 5) / 1s = 3 per second; raw value still present.
    expect(pts[1].v).toBe(8)
    expect(pts[1].rate).toBeCloseTo(3, 10)
  })

  it('returns histogram bucketCounts + explicitBounds on the wire', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(histogramMetricPayload()),
    } as any)

    const [{ id }] = await (
      await getMetricList({ url: makeUrl('/api/metrics') } as any)
    ).json()
    const detail = await (
      await getMetric({ params: { metricId: id } } as any)
    ).json()

    expect(detail.type).toBe('histogram')
    const p = detail.series[0].points[0]
    expect(p.count).toBe(3)
    expect(p.sum).toBe(42)
    expect(p.bucketCounts).toEqual([1, 1, 1])
    expect(p.explicitBounds).toEqual([10, 50])
  })

  it('returns exp-histogram scale + scaled buckets on the wire', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(expHistogramMetricPayload()),
    } as any)

    const [{ id }] = await (
      await getMetricList({ url: makeUrl('/api/metrics') } as any)
    ).json()
    const detail = await (
      await getMetric({ params: { metricId: id } } as any)
    ).json()

    expect(detail.type).toBe('exp_histogram')
    const p = detail.series[0].points[0]
    expect(p.scale).toBe(2)
    expect(p.zeroCount).toBe(1)
    expect(p.positive.bucketCounts).toEqual([2, 3, 1])
  })

  it('returns summary quantileValues on the wire', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(summaryMetricPayload()),
    } as any)

    const [{ id }] = await (
      await getMetricList({ url: makeUrl('/api/metrics') } as any)
    ).json()
    const detail = await (
      await getMetric({ params: { metricId: id } } as any)
    ).json()

    expect(detail.type).toBe('summary')
    const p = detail.series[0].points[0]
    expect(p.count).toBe(10)
    expect(p.sum).toBe(123)
    expect(p.quantileValues).toEqual([
      { quantile: 0.5, value: 10 },
      { quantile: 0.99, value: 50 },
    ])
  })
})

// ─── DELETE /api/metrics ──────────────────────────────────────────────────────

describe('DELETE /api/metrics', () => {
  it('clears all metrics when called with no body', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)
    await postOtlpMetrics({
      request: makeMetricsPostRequest(sumMetricPayload()),
    } as any)

    const clearResponse = await deleteMetrics({} as any)
    const body = await clearResponse.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('all')

    const listResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    expect(await listResponse.json()).toHaveLength(0)
  })

  it('deletes only selected metric IDs when ids are provided', async () => {
    await postOtlpMetrics({
      request: makeMetricsPostRequest(gaugeMetricPayload()),
    } as any)
    await postOtlpMetrics({
      request: makeMetricsPostRequest(sumMetricPayload()),
    } as any)

    const listResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const metrics = await listResponse.json()
    expect(metrics).toHaveLength(2)

    const idToDelete = metrics[0].id

    const deleteRequest = new Request('http://localhost/api/metrics', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [idToDelete] }),
    })

    const deleteResponse = await deleteMetrics({
      request: deleteRequest,
    } as any)
    const deleteBody = await deleteResponse.json()

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.mode).toBe('selected')
    expect(deleteBody.deletedCount).toBe(1)

    const afterResponse = await getMetricList({
      url: makeUrl('/api/metrics'),
    } as any)
    const remaining = await afterResponse.json()
    expect(remaining).toHaveLength(1)
    expect(remaining.find((m: any) => m.id === idToDelete)).toBeUndefined()
  })
})

// ─── GET /api/config ─────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  it('returns maxTraces as a positive integer', async () => {
    const response = await getConfig({} as any)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(typeof body.maxTraces).toBe('number')
    expect(body.maxTraces).toBeGreaterThan(0)
  })

  it('returns the default of 1000 when no env var is set', async () => {
    const response = await getConfig({} as any)
    const { maxTraces } = await response.json()
    expect(maxTraces).toBe(1000)
  })

  it('includes persistence mode metadata', async () => {
    const response = await getConfig({} as any)
    const body = await response.json()

    expect(body.persistence).toBeDefined()
    expect(['memory', 'pglite']).toContain(body.persistence.mode)
    expect(typeof body.persistence.enabled).toBe('boolean')
    expect(typeof body.persistence.restoredTraceCount).toBe('number')
    expect(typeof body.persistence.pendingFlushCount).toBe('number')
    if (body.persistence.unavailableReason != null) {
      expect(typeof body.persistence.unavailableReason).toBe('string')
    }
  })
})

// ─── GET /api/logs ────────────────────────────────────────────────────────────

describe('GET /api/logs', () => {
  it('returns empty array when no logs have been ingested', async () => {
    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await response.json()
    expect(logs).toEqual([])
  })

  it('returns correlated logs', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await response.json()

    expect(logs).toHaveLength(1)
    expect(logs[0].traceId).not.toBeNull()
    expect(logs[0].severityText).toBe('ERROR')
  })

  it('returns uncorrelated logs with null traceId and spanId', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await response.json()

    expect(logs.length).toBeGreaterThan(0)
    for (const log of logs) {
      expect(log.traceId).toBeNull()
      expect(log.spanId).toBeNull()
    }
  })

  it('returns both correlated and uncorrelated logs together', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await response.json()

    expect(logs.length).toBe(4) // 1 correlated + 3 unlinked
    expect(logs.some((l: any) => l.traceId !== null)).toBe(true)
    expect(logs.some((l: any) => l.traceId === null)).toBe(true)
  })

  it('respects the limit query param', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({
      url: makeUrl('/api/logs', { limit: '1' }),
    } as any)
    const logs = await response.json()

    expect(logs).toHaveLength(1)
  })

  it('applies limit filtering by returning only the newest log first', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({
      url: makeUrl('/api/logs', { limit: '1' }),
    } as any)
    const logs = await response.json()

    expect(logs).toHaveLength(1)
    expect(logs[0].body).toContain('Background job completed')
  })

  it('ignores invalid limit values and falls back to default behavior', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const invalidLimitResponse = await getLogList({
      url: makeUrl('/api/logs', { limit: 'abc' }),
    } as any)
    const nonPositiveLimitResponse = await getLogList({
      url: makeUrl('/api/logs', { limit: '0' }),
    } as any)

    const invalidLimitLogs = await invalidLimitResponse.json()
    const nonPositiveLimitLogs = await nonPositiveLimitResponse.json()

    expect(invalidLimitLogs).toHaveLength(3)
    expect(nonPositiveLimitLogs).toHaveLength(3)
  })

  it('returns logs sorted newest-first', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await response.json()

    for (let i = 1; i < logs.length; i++) {
      const prev = BigInt(
        logs[i - 1].timeUnixNano || logs[i - 1].observedTimeUnixNano || '0',
      )
      const curr = BigInt(
        logs[i].timeUnixNano || logs[i].observedTimeUnixNano || '0',
      )
      expect(prev >= curr).toBe(true)
    }
  })

  it('each log item has required LogListItem fields', async () => {
    await postOtlpLogs({
      request: makeLogsPostRequest(unlinkedLog),
    } as any)

    const response = await getLogList({ url: makeUrl('/api/logs') } as any)
    const [log] = await response.json()

    expect(typeof log.id).toBe('string')
    expect(log.traceId === null || typeof log.traceId === 'string').toBe(true)
    expect(log.spanId === null || typeof log.spanId === 'string').toBe(true)
    expect(typeof log.timeUnixNano).toBe('string')
    expect(typeof log.observedTimeUnixNano).toBe('string')
    expect(typeof log.severityNumber).toBe('number')
    expect(typeof log.severityText).toBe('string')
    expect(typeof log.serviceName).toBe('string')
  })
})

// ─── GET /api/logs/:logId ─────────────────────────────────────────────────────

describe('GET /api/logs/:logId', () => {
  it('returns 404 for unknown logId', async () => {
    await expect(
      getLog({
        params: { logId: 'missing-log-id' },
      } as any),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns full log detail payload for existing log', async () => {
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    const listResponse = await getLogList({
      url: makeUrl('/api/logs'),
    } as any)
    const logs = await listResponse.json()

    const response = await getLog({
      params: { logId: logs[0].id },
    } as any)
    const detail = await response.json()

    expect(detail.id).toBe(logs[0].id)
    expect(detail.attributes['retry_count']).toBe(2)
  })
})

// ─── DELETE /api/logs ────────────────────────────────────────────────────────

describe('DELETE /api/logs', () => {
  it('clears all logs when called with no body', async () => {
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(unlinkedLog) } as any)

    const clearResponse = await deleteLogs({} as any)
    const body = await clearResponse.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('all')

    const listResponse = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await listResponse.json()
    expect(logs).toHaveLength(0)
  })

  it('deletes only selected log IDs when logIds are provided', async () => {
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(unlinkedLog) } as any)

    const listResponse = await getLogList({ url: makeUrl('/api/logs') } as any)
    const logs = await listResponse.json()
    expect(logs.length).toBeGreaterThan(1)

    const idToDelete = logs[0].id

    const deleteRequest = new Request('http://localhost/api/logs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logIds: [idToDelete] }),
    })

    const deleteResponse = await deleteLogs({ request: deleteRequest } as any)
    const deleteBody = await deleteResponse.json()

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.mode).toBe('selected')
    expect(deleteBody.deletedCount).toBe(1)

    const afterResponse = await getLogList({ url: makeUrl('/api/logs') } as any)
    const remaining = await afterResponse.json()
    expect(remaining).toHaveLength(logs.length - 1)
    expect(remaining.find((l: any) => l.id === idToDelete)).toBeUndefined()
  })

  it('filters invalid logIds and deletes only valid matching IDs', async () => {
    await postOtlpLogs({ request: makeLogsPostRequest(unlinkedLog) } as any)

    const beforeResponse = await getLogList({
      url: makeUrl('/api/logs'),
    } as any)
    const before = await beforeResponse.json()
    const targetId = before[0].id

    const deleteRequest = new Request('http://localhost/api/logs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logIds: [targetId, 123, null, 'missing-id'],
      }),
    })

    const deleteResponse = await deleteLogs({ request: deleteRequest } as any)
    const deleteBody = await deleteResponse.json()
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.mode).toBe('selected')
    expect(deleteBody.deletedCount).toBe(1)

    const afterResponse = await getLogList({ url: makeUrl('/api/logs') } as any)
    const after = await afterResponse.json()
    expect(after).toHaveLength(before.length - 1)
    expect(after.find((l: any) => l.id === targetId)).toBeUndefined()
  })

  it('does not affect traces when clearing logs', async () => {
    await POST({ request: makePostRequest(simpleTrace) } as any)
    await postOtlpLogs({ request: makeLogsPostRequest(simpleLog) } as any)

    await deleteLogs({} as any)

    const traceListResponse = await getTraceList({
      url: makeUrl('/api/traces'),
    } as any)
    const traces = await traceListResponse.json()
    expect(traces).toHaveLength(1)
  })

  it('returns 400 for malformed JSON body', async () => {
    const deleteRequest = new Request('http://localhost/api/logs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    })

    const response = await deleteLogs({ request: deleteRequest } as any)
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/malformed json/i)
  })
})
