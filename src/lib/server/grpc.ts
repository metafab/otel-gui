// OTLP/gRPC receiver
//
// A minimal unary gRPC server built directly on node:http2 (cleartext h2c),
// so no gRPC library is needed. It implements the three OTLP collector
// services and reuses the protobuf decoders of the OTLP/HTTP receivers:
//
//   /opentelemetry.proto.collector.trace.v1.TraceService/Export
//   /opentelemetry.proto.collector.logs.v1.LogsService/Export
//   /opentelemetry.proto.collector.metrics.v1.MetricsService/Export
//
// Wire format (https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md):
// each message is prefixed with a 1-byte compressed flag and a 4-byte
// big-endian length. Status is reported in the `grpc-status` trailer.
import http2 from 'node:http2'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import {
  decodeProtobufLogs,
  decodeProtobufMetrics,
  decodeProtobufTraces,
} from '#lib/server/protobuf.js'

const gunzipAsync = promisify(gunzip)

// gRPC status codes used by the receiver
export const GrpcStatus = {
  OK: 0,
  INVALID_ARGUMENT: 3,
  RESOURCE_EXHAUSTED: 8,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
} as const

export const DEFAULT_GRPC_PORT = 4317

// Larger than the 4 MiB gRPC default so big exporter batches are accepted
export const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

const MESSAGE_HEADER_BYTES = 5

export interface OtlpGrpcIngest {
  ingestSpans(resourceSpans: any[]): void
  ingestLogs(resourceLogs: any[]): void
  ingestMetrics(resourceMetrics: any[]): void
}

interface ExportMethod {
  decode(buffer: Uint8Array): Promise<unknown[]>
  ingest(ingest: OtlpGrpcIngest, items: unknown[]): void
}

const EXPORT_METHODS: Record<string, ExportMethod> = {
  '/opentelemetry.proto.collector.trace.v1.TraceService/Export': {
    decode: async (buffer) =>
      (await decodeProtobufTraces(buffer)).resourceSpans,
    ingest: (ingest, items) => ingest.ingestSpans(items),
  },
  '/opentelemetry.proto.collector.logs.v1.LogsService/Export': {
    decode: async (buffer) => (await decodeProtobufLogs(buffer)).resourceLogs,
    ingest: (ingest, items) => ingest.ingestLogs(items),
  },
  '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export': {
    decode: async (buffer) =>
      (await decodeProtobufMetrics(buffer)).resourceMetrics,
    ingest: (ingest, items) => ingest.ingestMetrics(items),
  },
}

class GrpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

export interface OtlpGrpcServerOptions {
  /** Returns the store to ingest into; resolved per request. */
  getIngest: () => OtlpGrpcIngest
  maxMessageBytes?: number
}

/**
 * Create an HTTP/2 cleartext server that serves the OTLP gRPC export services.
 * The caller is responsible for calling `listen()`.
 */
export function createOtlpGrpcServer(
  options: OtlpGrpcServerOptions,
): http2.Http2Server {
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  const server = http2.createServer()

  server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
    // Never let a misbehaving client crash the process
    stream.on('error', () => {})
    handleStream(stream, headers, options.getIngest, maxMessageBytes).catch(
      (error) => {
        console.error('[otel-gui] Error processing OTLP gRPC request:', error)
        sendStatus(stream, GrpcStatus.INTERNAL, 'Internal server error')
      },
    )
  })
  server.on('sessionError', () => {})

  return server
}

async function handleStream(
  stream: http2.ServerHttp2Stream,
  headers: http2.IncomingHttpHeaders,
  getIngest: () => OtlpGrpcIngest,
  maxMessageBytes: number,
): Promise<void> {
  const contentType = headers['content-type'] ?? ''

  // Per the gRPC spec, non-gRPC requests get a plain HTTP error
  if (!contentType.startsWith('application/grpc')) {
    stream.respond({ ':status': 415 }, { endStream: true })
    return
  }
  if (headers[':method'] !== 'POST') {
    stream.respond({ ':status': 405 }, { endStream: true })
    return
  }
  if (
    contentType !== 'application/grpc' &&
    !contentType.startsWith('application/grpc+proto')
  ) {
    sendStatus(
      stream,
      GrpcStatus.UNIMPLEMENTED,
      `Unsupported content-type ${contentType}. Expected application/grpc+proto.`,
    )
    return
  }

  const method = EXPORT_METHODS[headers[':path'] ?? '']
  if (!method) {
    sendStatus(
      stream,
      GrpcStatus.UNIMPLEMENTED,
      `Unknown method ${headers[':path']}`,
    )
    return
  }

  const encoding = String(headers['grpc-encoding'] ?? 'identity')

  try {
    const body = await readBody(stream, maxMessageBytes + MESSAGE_HEADER_BYTES)
    const message = await readUnaryMessage(body, encoding, maxMessageBytes)

    let items: unknown[]
    try {
      items = await method.decode(message)
    } catch {
      throw new GrpcError(
        GrpcStatus.INVALID_ARGUMENT,
        'Malformed protobuf payload',
      )
    }

    method.ingest(getIngest(), items ?? [])
  } catch (error) {
    if (error instanceof GrpcError) {
      sendStatus(stream, error.code, error.message)
      return
    }
    throw error
  }

  // An empty Export*ServiceResponse signals full success
  if (stream.destroyed) return
  stream.respond(
    { ':status': 200, 'content-type': 'application/grpc' },
    { waitForTrailers: true },
  )
  stream.on('wantTrailers', () => {
    stream.sendTrailers({ 'grpc-status': String(GrpcStatus.OK) })
  })
  stream.end(Buffer.alloc(MESSAGE_HEADER_BYTES))
}

function readBody(
  stream: http2.ServerHttp2Stream,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        stream.removeAllListeners('data')
        stream.resume()
        reject(
          new GrpcError(
            GrpcStatus.RESOURCE_EXHAUSTED,
            `Received message larger than max (${maxBytes - MESSAGE_HEADER_BYTES} bytes)`,
          ),
        )
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * Extract the single length-prefixed message of a unary call, decompressing
 * it when the compressed flag is set.
 */
export async function readUnaryMessage(
  body: Buffer,
  encoding: string,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
): Promise<Uint8Array> {
  if (body.length < MESSAGE_HEADER_BYTES) {
    throw new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Missing request message')
  }

  const compressed = body.readUInt8(0)
  const length = body.readUInt32BE(1)
  if (body.length !== MESSAGE_HEADER_BYTES + length) {
    throw new GrpcError(
      GrpcStatus.INVALID_ARGUMENT,
      'Expected exactly one request message',
    )
  }

  const payload = body.subarray(MESSAGE_HEADER_BYTES)
  if (compressed === 0) return payload
  if (compressed !== 1) {
    throw new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Invalid compressed flag')
  }

  if (encoding !== 'gzip') {
    throw new GrpcError(
      GrpcStatus.UNIMPLEMENTED,
      `Unsupported grpc-encoding ${encoding}`,
    )
  }

  let decompressed: Buffer
  try {
    decompressed = await gunzipAsync(payload, {
      maxOutputLength: maxMessageBytes,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new GrpcError(
        GrpcStatus.RESOURCE_EXHAUSTED,
        `Decompressed message larger than max (${maxMessageBytes} bytes)`,
      )
    }
    throw new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Malformed gzip payload')
  }
  return decompressed
}

/** Send a trailers-only gRPC response carrying a status code. */
function sendStatus(
  stream: http2.ServerHttp2Stream,
  code: number,
  message: string,
): void {
  if (stream.destroyed || stream.closed) return
  if (stream.headersSent) {
    stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR)
    return
  }
  stream.respond(
    {
      ':status': 200,
      'content-type': 'application/grpc',
      'grpc-status': String(code),
      'grpc-message': encodeURIComponent(message),
      'grpc-accept-encoding': 'identity,gzip',
    },
    { endStream: true },
  )
}

/** Parse OTEL_GUI_GRPC_ENABLED: enabled unless explicitly `0` or `false`. */
export function grpcIsEnabled(value: string | undefined): boolean {
  return (
    value === undefined ||
    value === '' ||
    !['0', 'false'].includes(value.toLowerCase())
  )
}

/** Parse OTEL_GUI_GRPC_PORT, falling back to 4317 on invalid values. */
export function resolveGrpcPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_GRPC_PORT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    console.warn(
      `[otel-gui] Invalid OTEL_GUI_GRPC_PORT="${raw}". Must be an integer between 1 and 65535. Falling back to ${DEFAULT_GRPC_PORT}.`,
    )
    return DEFAULT_GRPC_PORT
  }
  return parsed
}

interface GrpcReceiverState {
  server: http2.Http2Server
  getIngest: () => OtlpGrpcIngest
}

// Kept on globalThis so dev-server module reloads reuse the listening socket
// instead of failing with EADDRINUSE; the ingest target is refreshed instead.
const STATE_KEY = Symbol.for('otel-gui.grpcReceiver')
type GlobalWithGrpc = typeof globalThis & {
  [STATE_KEY]?: GrpcReceiverState
}

export interface StartGrpcReceiverOptions {
  enabled: string | undefined
  port: string | undefined
  host: string | undefined
  getIngest: () => OtlpGrpcIngest
}

/**
 * Start the OTLP/gRPC receiver once per process. Startup failures (such as
 * the port being in use) are logged and never prevent the HTTP server from
 * running.
 */
export function startGrpcReceiver(options: StartGrpcReceiverOptions): void {
  if (!grpcIsEnabled(options.enabled)) return

  const g = globalThis as GlobalWithGrpc
  const existing = g[STATE_KEY]
  if (existing) {
    existing.getIngest = options.getIngest
    return
  }

  const port = resolveGrpcPort(options.port)
  const host = options.host || undefined
  const state = {} as GrpcReceiverState
  state.getIngest = options.getIngest
  state.server = createOtlpGrpcServer({
    getIngest: () => state.getIngest(),
  })
  g[STATE_KEY] = state

  state.server.on('error', (error: NodeJS.ErrnoException) => {
    delete g[STATE_KEY]
    const reason =
      error.code === 'EADDRINUSE' ? `port ${port} is already in use` : error
    console.warn(
      `[otel-gui] OTLP/gRPC receiver disabled: ${reason}. Set OTEL_GUI_GRPC_PORT to use another port, or OTEL_GUI_GRPC_ENABLED=false to silence this warning.`,
    )
  })
  state.server.listen(port, host, () => {
    console.log(
      `[otel-gui] OTLP/gRPC receiver listening on ${host ?? '*'}:${port}`,
    )
  })
  // The HTTP server owns the process lifetime; don't keep it alive on our own
  state.server.unref()

  process.once('sveltekit:shutdown', () => {
    state.server.close()
    delete g[STATE_KEY]
  })
}
