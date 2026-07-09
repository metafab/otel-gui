import { describe, it, expect } from 'vitest'
import { createInternalTraceStore } from '$lib/server/traceStore/core'
import { createMcpDispatcher, type JsonRpcResponse } from './jsonrpc'

function seededDispatcher() {
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
              status: { code: 2, message: 'boom' },
            },
          ],
        },
      ],
    },
  ])
  return createMcpDispatcher(store)
}

function call(
  dispatch: ReturnType<typeof createMcpDispatcher>,
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
): JsonRpcResponse {
  const res = dispatch({ jsonrpc: '2.0', id, method, params })
  return res as JsonRpcResponse
}

describe('MCP dispatcher', () => {
  it('answers initialize with serverInfo and echoes the protocol version', () => {
    const res = call(seededDispatcher(), 'initialize', {
      protocolVersion: '2025-06-18',
    })
    const result = res.result as any
    expect(result.serverInfo.name).toBe('otel-gui')
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('lists all tools with input schemas', () => {
    const res = call(seededDispatcher(), 'tools/list')
    const tools = (res.result as any).tools as any[]
    const names = tools.map((t) => t.name)
    expect(names).toContain('search')
    expect(names).toContain('get_trace')
    expect(names).toContain('list_services')
    expect(tools.every((t) => t.inputSchema?.type === 'object')).toBe(true)
  })

  it('runs a search tool call and returns structured content', () => {
    const res = call(seededDispatcher(), 'tools/call', {
      name: 'search',
      arguments: { query: 'checkout' },
    })
    const result = res.result as any
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.traces.length).toBeGreaterThan(0)
    // A text mirror of the same payload is always present.
    expect(result.content[0].type).toBe('text')
  })

  it('returns an isError tool result when a trace is missing', () => {
    const res = call(seededDispatcher(), 'tools/call', {
      name: 'get_trace',
      arguments: { traceId: 'nope' },
    })
    const result = res.result as any
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Trace not found')
  })

  it('rejects an unknown tool with an invalid-params error', () => {
    const res = call(seededDispatcher(), 'tools/call', { name: 'frobnicate' })
    expect(res.error?.code).toBe(-32602)
  })

  it('returns method-not-found for an unknown method', () => {
    const res = call(seededDispatcher(), 'bogus/method')
    expect(res.error?.code).toBe(-32601)
  })

  it('treats a message without id as a notification (no reply)', () => {
    const dispatch = seededDispatcher()
    expect(
      dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull()
  })

  it('answers ping', () => {
    const res = call(seededDispatcher(), 'ping')
    expect(res.result).toEqual({})
  })

  it('flushes all buffers and reports cleared counts', () => {
    const dispatch = seededDispatcher()
    const res = call(dispatch, 'tools/call', {
      name: 'flush',
      arguments: {},
    })
    const result = res.result as any
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.cleared.traces).toBe(1)

    // A follow-up search finds nothing now that the store is empty.
    const after = call(dispatch, 'tools/call', {
      name: 'search',
      arguments: { query: 'checkout' },
    })
    expect((after.result as any).structuredContent.traces).toEqual([])
  })
})
