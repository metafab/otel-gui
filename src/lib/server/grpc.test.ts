import http2 from 'node:http2'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import protobuf from 'protobufjs'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createOtlpGrpcServer,
  grpcIsEnabled,
  GrpcStatus,
  resolveGrpcPort,
} from './grpc.js'

const TRACE_PATH = '/opentelemetry.proto.collector.trace.v1.TraceService/Export'
const LOGS_PATH = '/opentelemetry.proto.collector.logs.v1.LogsService/Export'
const METRICS_PATH =
  '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export'

const ingest = {
  ingestSpans: vi.fn(),
  ingestLogs: vi.fn(),
  ingestMetrics: vi.fn(),
}

let server: http2.Http2Server
let client: http2.ClientHttp2Session
let root: protobuf.Root

beforeAll(async () => {
  const protoRoot = join(process.cwd(), 'proto')
  root = new protobuf.Root()
  root.resolvePath = (_origin, target) => join(protoRoot, target)
  await root.load([
    'opentelemetry/proto/collector/trace/v1/trace_service.proto',
    'opentelemetry/proto/collector/logs/v1/logs_service.proto',
    'opentelemetry/proto/collector/metrics/v1/metrics_service.proto',
  ])

  server = createOtlpGrpcServer({
    getIngest: () => ingest,
    maxMessageBytes: 1024,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  client = http2.connect(`http://127.0.0.1:${port}`)
})

afterAll(async () => {
  client?.close()
  await new Promise((resolve) => server?.close(resolve))
})

beforeEach(() => {
  ingest.ingestSpans.mockReset()
  ingest.ingestLogs.mockReset()
  ingest.ingestMetrics.mockReset()
})

function encode(typeName: string, payload: object): Uint8Array {
  const type = root.lookupType(typeName)
  return type.encode(type.fromObject(payload)).finish()
}

function frame(message: Uint8Array, compressed = false): Buffer {
  const header = Buffer.alloc(5)
  header.writeUInt8(compressed ? 1 : 0, 0)
  header.writeUInt32BE(message.length, 1)
  return Buffer.concat([header, message])
}

interface CallResult {
  status: number
  grpcStatus: number | null
  grpcMessage: string | null
  grpcAcceptEncoding: string | null
  body: Buffer
}

function call(
  path: string,
  body: Buffer,
  headers: http2.OutgoingHttpHeaders = {},
): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/grpc',
      te: 'trailers',
      ...headers,
    })
    let status = 0
    let grpcStatus: string | undefined
    let grpcMessage: string | undefined
    let grpcAcceptEncoding: string | undefined
    const chunks: Buffer[] = []
    req.on('response', (h) => {
      status = Number(h[':status'])
      grpcStatus ??= h['grpc-status'] as string | undefined
      grpcMessage ??= h['grpc-message'] as string | undefined
      grpcAcceptEncoding = h['grpc-accept-encoding'] as string | undefined
    })
    req.on('trailers', (t) => {
      grpcStatus = t['grpc-status'] as string | undefined
      grpcMessage = t['grpc-message'] as string | undefined
    })
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () =>
      resolve({
        status,
        grpcStatus: grpcStatus === undefined ? null : Number(grpcStatus),
        grpcMessage:
          grpcMessage === undefined ? null : decodeURIComponent(grpcMessage),
        grpcAcceptEncoding: grpcAcceptEncoding ?? null,
        body: Buffer.concat(chunks),
      }),
    )
    req.on('error', reject)
    req.end(body)
  })
}

const traceRequest = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'grpc-svc' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex'),
              spanId: Buffer.from('1112131415161718', 'hex'),
              name: 'grpc-span',
              kind: 2,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000000500000000',
            },
          ],
        },
      ],
    },
  ],
}

describe(createOtlpGrpcServer, () => {
  it('ingests traces with hex-encoded ids and returns an empty OK response', async () => {
    const message = encode(
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      traceRequest,
    )

    const result = await call(TRACE_PATH, frame(message))

    expect(result.status).toBe(200)
    expect(result.grpcStatus).toBe(GrpcStatus.OK)
    expect(result.grpcAcceptEncoding).toBe('identity,gzip')
    expect(result.body).toEqual(Buffer.alloc(5))
    expect(ingest.ingestSpans).toHaveBeenCalledOnce()
    const [resourceSpans] = ingest.ingestSpans.mock.calls[0]
    const span = resourceSpans[0].scopeSpans[0].spans[0]
    expect(span.traceId).toBe('0102030405060708090a0b0c0d0e0f10')
    expect(span.spanId).toBe('1112131415161718')
    expect(span.name).toBe('grpc-span')
  })

  it('accepts gzip-compressed messages', async () => {
    const message = encode(
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      traceRequest,
    )

    const result = await call(TRACE_PATH, frame(gzipSync(message), true), {
      'grpc-encoding': 'gzip',
    })

    expect(result.grpcStatus).toBe(GrpcStatus.OK)
    expect(ingest.ingestSpans).toHaveBeenCalledOnce()
  })

  it('ingests logs', async () => {
    const message = encode(
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest',
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000',
                    severityNumber: 9,
                    body: { stringValue: 'hello over grpc' },
                  },
                ],
              },
            ],
          },
        ],
      },
    )

    const result = await call(LOGS_PATH, frame(message))

    expect(result.grpcStatus).toBe(GrpcStatus.OK)
    const [resourceLogs] = ingest.ingestLogs.mock.calls[0]
    expect(resourceLogs[0].scopeLogs[0].logRecords[0].body).toMatchObject({
      stringValue: 'hello over grpc',
    })
  })

  it('ingests metrics', async () => {
    const message = encode(
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest',
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'queue.depth',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: '1700000000000000000', asInt: '3' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    )

    const result = await call(METRICS_PATH, frame(message))

    expect(result.grpcStatus).toBe(GrpcStatus.OK)
    const [resourceMetrics] = ingest.ingestMetrics.mock.calls[0]
    expect(resourceMetrics[0].scopeMetrics[0].metrics[0].name).toBe(
      'queue.depth',
    )
  })

  it('returns UNIMPLEMENTED for unknown methods', async () => {
    const result = await call('/foo.Bar/Baz', frame(new Uint8Array(0)))

    expect(result.status).toBe(200)
    expect(result.grpcStatus).toBe(GrpcStatus.UNIMPLEMENTED)
  })

  it('returns INVALID_ARGUMENT for malformed protobuf', async () => {
    const result = await call(
      TRACE_PATH,
      frame(Buffer.from([0xff, 0xff, 0xff])),
    )

    expect(result.grpcStatus).toBe(GrpcStatus.INVALID_ARGUMENT)
    expect(ingest.ingestSpans).not.toHaveBeenCalled()
  })

  it('returns INVALID_ARGUMENT for truncated frames', async () => {
    const result = await call(TRACE_PATH, Buffer.from([0, 0, 0, 0, 10, 1]))

    expect(result.grpcStatus).toBe(GrpcStatus.INVALID_ARGUMENT)
  })

  it('returns UNIMPLEMENTED for unsupported compression', async () => {
    const result = await call(TRACE_PATH, frame(Buffer.from([1]), true), {
      'grpc-encoding': 'snappy',
    })

    expect(result.grpcStatus).toBe(GrpcStatus.UNIMPLEMENTED)
  })

  it('resets oversized uploads without draining the remaining request', async () => {
    const req = client.request({
      ':method': 'POST',
      ':path': TRACE_PATH,
      'content-type': 'application/grpc',
      te: 'trailers',
    })
    const reset = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Oversized upload stream was not reset')),
        1000,
      )
      req.once('close', () => {
        clearTimeout(timeout)
        resolve(req.rstCode)
      })
    })
    req.write(Buffer.alloc(2048))

    await expect(reset).resolves.toBe(http2.constants.NGHTTP2_CANCEL)

    const message = encode(
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      { resourceSpans: [] },
    )
    const result = await call(TRACE_PATH, frame(message))
    expect(result.grpcStatus).toBe(GrpcStatus.OK)
  })

  it('returns RESOURCE_EXHAUSTED for oversized decompressed messages', async () => {
    const result = await call(
      TRACE_PATH,
      frame(gzipSync(Buffer.alloc(4096)), true),
      {
        'grpc-encoding': 'gzip',
      },
    )

    expect(result.grpcStatus).toBe(GrpcStatus.RESOURCE_EXHAUSTED)
  })

  it('rejects non-gRPC requests with HTTP 415', async () => {
    const result = await call(TRACE_PATH, Buffer.from('{}'), {
      'content-type': 'application/json',
    })

    expect(result.status).toBe(415)
  })

  it('logs unexpected stream transport errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const streamReady = new Promise<void>((resolve) => {
      server.once('stream', () => resolve())
    })
    const req = client.request({
      ':method': 'POST',
      ':path': TRACE_PATH,
      'content-type': 'application/grpc',
      te: 'trailers',
    })
    req.on('error', () => {})

    await streamReady
    req.close(http2.constants.NGHTTP2_PROTOCOL_ERROR)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[otel-gui] OTLP gRPC stream transport error:',
        TRACE_PATH,
        expect.any(Error),
      )
    })
    warn.mockRestore()
  })

  it('logs session transport errors', () => {
    const error = new Error('test session transport failure')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    server.emit('sessionError', error)

    expect(log).toHaveBeenCalledWith(
      '[otel-gui] OTLP gRPC session transport error:',
      error,
    )
    log.mockRestore()
  })
})

describe(grpcIsEnabled, () => {
  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['1', true],
    ['0', false],
    ['false', false],
    ['FALSE', false],
  ])('parses %j as %j', (value, expected) => {
    expect(grpcIsEnabled(value)).toBe(expected)
  })
})

describe(resolveGrpcPort, () => {
  it('defaults to 4317', () => {
    expect(resolveGrpcPort(undefined)).toBe(4317)
    expect(resolveGrpcPort('')).toBe(4317)
  })

  it('accepts valid ports', () => {
    expect(resolveGrpcPort('14317')).toBe(14317)
  })

  it('falls back on invalid ports', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveGrpcPort('abc')).toBe(4317)
    expect(resolveGrpcPort('70000')).toBe(4317)
    expect(resolveGrpcPort('1.5')).toBe(4317)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})
