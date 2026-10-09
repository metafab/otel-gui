import { describe, it, expect, vi } from 'vitest'

describe('protobuf concurrent first load', () => {
  const empty = new Uint8Array(0)

  it('decodes traces and logs requested concurrently', async () => {
    const m = await freshModule()

    const [traces, logs] = await Promise.all([
      m.decodeProtobufTraces(empty),
      m.decodeProtobufLogs(empty),
    ])

    expect(traces.resourceSpans).toEqual([])
    expect(logs.resourceLogs).toEqual([])
  })

  it('decodes traces, logs and metrics requested concurrently', async () => {
    const m = await freshModule()

    const [traces, logs, metrics] = await Promise.all([
      m.decodeProtobufTraces(empty),
      m.decodeProtobufLogs(empty),
      m.decodeProtobufMetrics(empty),
    ])

    expect(traces.resourceSpans).toEqual([])
    expect(logs.resourceLogs).toEqual([])
    expect(metrics.resourceMetrics).toEqual([])
  })

  it('handles multiple concurrent first trace requests', async () => {
    const m = await freshModule()

    const results = await Promise.all([
      m.decodeProtobufTraces(empty),
      m.decodeProtobufTraces(empty),
      m.decodeProtobufTraces(empty),
    ])

    for (const r of results) expect(r.resourceSpans).toEqual([])
  })
})

/**
 * Returns a fresh import of the protobuf module, resetting the module cache,
 * allowing each test to import a fresh module so the lazy proto load starts from scratch.
 */
async function freshModule() {
  vi.resetModules()
  return import('./protobuf.js')
}
