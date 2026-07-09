import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string>,
}))

// The route builds its dispatcher from the singleton at import time; a bare
// object is enough because initialize / tools.list / the guards never touch it.
vi.mock('$lib/server/traceStore', () => ({ traceStore: {} }))
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }))

import { POST, GET } from './+server'

function post(body: unknown, address = '127.0.0.1') {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return POST({ request, getClientAddress: () => address } as any)
}

describe('POST /mcp', () => {
  beforeEach(() => {
    for (const k of Object.keys(mocks.env)) delete mocks.env[k]
  })

  it('rejects non-loopback callers with 403', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      '10.1.2.3',
    )
    expect(res.status).toBe(403)
  })

  it('accepts IPv4-mapped IPv6 loopback', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      '::ffff:127.0.0.1',
    )
    expect(res.status).toBe(200)
  })

  it('returns 404 when disabled via env', async () => {
    mocks.env.OTEL_GUI_MCP_ENABLED = '0'
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(res.status).toBe(404)
  })

  it('allows non-loopback callers when OTEL_GUI_MCP_ALLOW_REMOTE=1 (Docker/proxy)', async () => {
    mocks.env.OTEL_GUI_MCP_ALLOW_REMOTE = '1'
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      '172.17.0.1',
    )
    expect(res.status).toBe(200)
  })

  it('answers initialize over HTTP', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('otel-gui')
  })

  it('returns a JSON-RPC parse error for malformed JSON', async () => {
    const res = await post('{ not json', '127.0.0.1')
    const body = await res.json()
    expect(body.error.code).toBe(-32700)
  })

  it('returns 202 with no body for a notification', async () => {
    const res = await post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })
})

describe('GET /mcp', () => {
  it('is 405 (no server-initiated stream)', async () => {
    const res = await GET({} as any)
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })
})
