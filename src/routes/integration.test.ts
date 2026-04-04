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
import { POST as postOtlpMetrics } from './v1/metrics/+server'
import { POST as postOtlpLogs } from './v1/logs/+server'
import { traceStore } from '$lib/server/traceStore'
import simpleTrace from '../../tests/fixtures/simple-trace.json'
import simpleLog from '../../tests/fixtures/simple-log.json'
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

    traceStore.clear()
    await POST({
      request: makePostRequest(
        exportedPayload.traces[0],
      ),
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

    traceStore.clear()

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

    traceStore.clear()

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

    traceStore.clear()

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

  it('returns 501 for POST /v1/metrics', async () => {
    const request = makePostRequest({ resourceMetrics: [] })
    const response = await postOtlpMetrics({ request } as any)
    expect(response.status).toBe(501)

    const body = await response.json()
    expect(body.error).toMatch(/not implemented/i)
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
