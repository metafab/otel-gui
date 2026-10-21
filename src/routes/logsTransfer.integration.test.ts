import { describe, it, expect, beforeEach } from 'vitest'
import { POST as postOtlpLogs } from './v1/logs/+server'
import { GET as getLogList } from './api/logs/+server'
import { POST as exportLogs } from './api/logs/export/+server'
import { POST as previewLogImport } from './api/logs/import/preview/+server'
import { POST as importLogs } from './api/logs/import/+server'
import { POST as previewTraceImport } from './api/traces/import/preview/+server'
import { traceStore } from '#lib/server/traceStore.js'
import simpleTrace from '../../tests/fixtures/simple-trace.json'
import simpleLog from '../../tests/fixtures/simple-log.json'
import unlinkedLog from '../../tests/fixtures/log-unlinked.json'

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function ingest(payload: unknown) {
  await postOtlpLogs({
    request: jsonRequest('/v1/logs', payload),
  } as any)
}

async function listLogs() {
  const response = await getLogList({
    url: new URL('http://localhost/api/logs'),
  } as any)
  return (await response.json()) as Array<{ id: string }>
}

async function exportAll() {
  const ids = (await listLogs()).map((log) => log.id)
  const response = await exportLogs({
    request: jsonRequest('/api/logs/export', { logIds: ids }),
  } as any)
  return { response, payload: await response.json() }
}

beforeEach(() => {
  traceStore.clearTraces()
  traceStore.clearLogs()
})

describe('POST /api/logs/export', () => {
  it('exports the requested logs in the otel-gui envelope', async () => {
    await ingest(simpleLog)
    await ingest(unlinkedLog)
    const [first] = await listLogs()

    const response = await exportLogs({
      request: jsonRequest('/api/logs/export', { logIds: [first.id] }),
    } as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(/logs-.*\.json/)
    expect(payload.format).toBe('otel-gui-log-export')
    expect(payload.logCount).toBe(1)
    expect(payload.logs[0].logId).toBe(first.id)
  })

  it('returns 400 for a missing or invalid logIds payload', async () => {
    const response = await exportLogs({
      request: jsonRequest('/api/logs/export', {}),
    } as any)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/logIds/i)
  })

  it('returns 404 when no log matches', async () => {
    const response = await exportLogs({
      request: jsonRequest('/api/logs/export', { logIds: ['nope'] }),
    } as any)
    expect(response.status).toBe(404)
  })
})

describe('POST /api/logs/import/preview', () => {
  it('previews an exported envelope without ingesting it', async () => {
    await ingest(simpleLog)
    const { payload } = await exportAll()
    traceStore.clearLogs()

    const response = await previewLogImport({
      request: jsonRequest('/api/logs/import/preview', {
        fileName: 'logs.json',
        content: JSON.stringify(payload),
      }),
    } as any)
    const preview = await response.json()

    expect(response.status).toBe(200)
    expect(preview.format).toBe('otel-gui-log-export')
    expect(preview.logCount).toBe(payload.logCount)
    expect(preview.fileName).toBe('logs.json')
    expect(await listLogs()).toHaveLength(0)
  })

  it('accepts raw OTLP JSON', async () => {
    const response = await previewLogImport({
      request: jsonRequest('/api/logs/import/preview', {
        content: JSON.stringify(simpleLog),
      }),
    } as any)
    const preview = await response.json()

    expect(response.status).toBe(200)
    expect(preview.format).toBe('otlp-json')
    expect(preview.logCount).toBeGreaterThan(0)
  })

  it.each([
    ['malformed JSON', 'not json'],
    ['unsupported payload', JSON.stringify({ hello: 'world' })],
    ['no records', JSON.stringify({ resourceLogs: [] })],
  ])('returns 400 for %s', async (_label, content) => {
    const response = await previewLogImport({
      request: jsonRequest('/api/logs/import/preview', { content }),
    } as any)
    expect(response.status).toBe(400)
  })

  it('returns 400 when content is missing', async () => {
    const response = await previewLogImport({
      request: jsonRequest('/api/logs/import/preview', {}),
    } as any)
    expect(response.status).toBe(400)
  })
})

describe('POST /api/logs/import', () => {
  it('round-trips an export, preserving log content and ids', async () => {
    await ingest(simpleLog)
    await ingest(unlinkedLog)
    const before = await listLogs()
    const originals = before.map((log) => traceStore.getLog(log.id))
    const { payload } = await exportAll()
    traceStore.clearLogs()

    const response = await importLogs({
      request: jsonRequest('/api/logs/import', {
        content: JSON.stringify(payload),
      }),
    } as any)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.importedLogCount).toBe(before.length)

    const after = await listLogs()
    expect(after).toHaveLength(before.length)
    for (const original of originals) {
      const restored = after
        .map((log) => traceStore.getLog(log.id)!)
        .find(
          (log) =>
            log.timeUnixNano === original!.timeUnixNano &&
            log.body === original!.body,
        )
      expect(restored).toBeDefined()
      expect(restored!.severityText).toBe(original!.severityText)
      expect(restored!.traceId).toBe(original!.traceId)
      expect(restored!.resource).toEqual(original!.resource)
    }
  })

  it('does not duplicate logs when re-importing into a populated store', async () => {
    await ingest(simpleLog)
    await ingest(unlinkedLog)
    const count = (await listLogs()).length
    const { payload } = await exportAll()

    const response = await importLogs({
      request: jsonRequest('/api/logs/import', {
        content: JSON.stringify(payload),
      }),
    } as any)

    expect(response.status).toBe(200)
    expect(await listLogs()).toHaveLength(count)
  })

  it('imports raw OTLP JSON', async () => {
    const response = await importLogs({
      request: jsonRequest('/api/logs/import', {
        content: JSON.stringify(simpleLog),
      }),
    } as any)

    expect(response.status).toBe(200)
    expect((await listLogs()).length).toBeGreaterThan(0)
  })

  it('returns 400 for invalid payloads without ingesting', async () => {
    const response = await importLogs({
      request: jsonRequest('/api/logs/import', {
        content: JSON.stringify({ resourceLogs: [{ scopeLogs: [{}] }] }),
      }),
    } as any)

    expect(response.status).toBe(400)
    expect(await listLogs()).toHaveLength(0)
  })
})

describe('cross-type import detection', () => {
  async function preview(handler: any, path: string, payload: unknown) {
    const response = await handler({
      request: jsonRequest(path, { content: JSON.stringify(payload) }),
    } as any)
    return { status: response.status, error: (await response.json()).error }
  }

  it('tells the user when a log export is imported as traces', async () => {
    await ingest(simpleLog)
    const { payload } = await exportAll()
    const result = await preview(
      previewTraceImport,
      '/api/traces/import/preview',
      payload,
    )
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/contains logs, not traces/)
  })

  it('tells the user when raw OTLP logs are imported as traces', async () => {
    const result = await preview(
      previewTraceImport,
      '/api/traces/import/preview',
      simpleLog,
    )
    expect(result.error).toMatch(/contains logs, not traces/)
  })

  it('tells the user when traces are imported as logs', async () => {
    const result = await preview(
      previewLogImport,
      '/api/logs/import/preview',
      simpleTrace,
    )
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/contains traces, not logs/)
  })

  it('tells the user when a trace export is imported as logs', async () => {
    const result = await preview(previewLogImport, '/api/logs/import/preview', {
      format: 'otel-gui-trace-export',
      traces: [],
    })
    expect(result.error).toMatch(/contains traces, not logs/)
  })

  it('keeps the generic message for unrelated JSON', async () => {
    for (const [handler, path] of [
      [previewTraceImport, '/api/traces/import/preview'],
      [previewLogImport, '/api/logs/import/preview'],
    ] as const) {
      const result = await preview(handler, path, { hello: 'world' })
      expect(result.error).toMatch(/Unsupported import payload/)
    }
  })
})
