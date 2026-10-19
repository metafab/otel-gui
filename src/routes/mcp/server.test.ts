import { beforeEach, describe, expect, it } from 'vitest'
import { POST } from './+server'
import { traceStore } from '#lib/server/traceStore.js'

const traceId = '0123456789abcdef0123456789abcdef'

function makeRequest(
  body: unknown,
  clientAddress = '127.0.0.1',
): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://localhost:4318/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify(body),
    }),
    getClientAddress: () => clientAddress,
  } as Parameters<typeof POST>[0]
}

async function post(body: unknown, clientAddress?: string): Promise<Response> {
  return POST(makeRequest(body, clientAddress))
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const response = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  return (await response.json()).result
}

function seedTrace() {
  traceStore.ingestSpans([
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId,
              spanId: '0123456789abcdef',
              name: 'POST /checkout',
              kind: 2,
              startTimeUnixNano: '1000000000',
              endTimeUnixNano: '2000000000',
              status: { code: 2, message: 'payment failed' },
              attributes: [
                { key: 'http.method', value: { stringValue: 'POST' } },
              ],
            },
          ],
        },
      ],
    },
  ])
}

beforeEach(() => {
  traceStore.clearTraces()
  traceStore.clearLogs()
  traceStore.clearMetrics()
  seedTrace()
})

describe('POST /mcp', () => {
  it('rejects non-loopback callers by default', async () => {
    const response = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      '192.168.1.20',
    )
    expect(response.status).toBe(403)
  })

  it('initializes with the MCP server identity', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.serverInfo.name).toBe('otel-gui')
    expect(body.result.capabilities.tools).toBeDefined()
  })

  it('lists read-only tools', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      'search_traces',
      'get_trace',
      'search_logs',
      'get_log',
      'search_metrics',
      'get_metric',
      'list_services',
      'get_service_map',
    ])
    expect(
      body.result.tools.every(
        (tool: { annotations?: { readOnlyHint?: boolean } }) =>
          tool.annotations?.readOnlyHint === true,
      ),
    ).toBe(true)
  })

  it('searches telemetry through the live trace store', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_traces',
        arguments: { query: 'payment failed' },
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.isError).toBeUndefined()
    const result = JSON.parse(body.result.content[0].text)
    expect(result.total).toBe(1)
    expect(result.traces[0].traceId).toBe(traceId)
    expect(result.traces[0].matchedSpans[0].name).toBe('POST /checkout')
  })

  it('returns MCP tool errors for unknown trace IDs', async () => {
    const result = await callTool('get_trace', {
      traceId: 'ffffffffffffffffffffffffffffffff',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Trace not found')
  })

  it('returns bounded trace details', async () => {
    const result = await callTool('get_trace', { traceId, maxSpans: 1 })
    const trace = JSON.parse(result.content[0].text)
    expect(trace.spanCount).toBe(1)
    expect(trace.truncated).toBe(false)
    expect(trace.spans[0].name).toBe('POST /checkout')
  })

  it('reads logs, metrics, service counts, and the service map', async () => {
    traceStore.ingestLogs([
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1500000000',
                severityNumber: 17,
                severityText: 'ERROR',
                body: { stringValue: 'payment failed' },
                traceId,
                spanId: '0123456789abcdef',
                attributes: [
                  {
                    key: 'log.record.uid',
                    value: { stringValue: 'mcp-log-1' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    traceStore.ingestMetrics([
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
                description: 'Request duration',
                unit: 'ms',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1500000000',
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
            ],
          },
        ],
      },
    ])

    const logSearch = await callTool('search_logs', {
      query: 'payment failed',
      service: 'checkout',
      severityMin: 17,
      traceId,
    })
    expect(logSearch.isError).toBeUndefined()
    expect(JSON.parse(logSearch.content[0].text).logs).toHaveLength(1)

    const logDetail = await callTool('get_log', { logId: 'mcp-log-1' })
    expect(JSON.parse(logDetail.content[0].text).log.body).toBe(
      'payment failed',
    )

    const metricSearch = await callTool('search_metrics', {
      query: 'checkout',
    })
    const metricList = JSON.parse(metricSearch.content[0].text).metrics
    expect(metricList).toHaveLength(1)

    const metricDetail = await callTool('get_metric', {
      metricId: metricList[0].id,
      maxPointsPerSeries: 1,
    })
    const metric = JSON.parse(metricDetail.content[0].text)
    expect(metric.name).toBe('http.server.duration')
    expect(metric.series[0].points).toHaveLength(1)

    const services = await callTool('list_services')
    expect(JSON.parse(services.content[0].text).services).toContainEqual(
      expect.objectContaining({
        name: 'checkout',
        traceCount: 1,
        logCount: 1,
        metricCount: 1,
      }),
    )

    const serviceMap = await callTool('get_service_map')
    expect(JSON.parse(serviceMap.content[0].text).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceName: 'checkout' }),
      ]),
    )
  })

  it('rejects tool arguments outside declared schemas', async () => {
    const result = await callTool('search_traces', { limit: 0 })
    expect(result.isError).toBe(true)
  })
})
