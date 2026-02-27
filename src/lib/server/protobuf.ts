// Protobuf decoder for OTLP traces
import protobuf from 'protobufjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load proto files
let root: protobuf.Root | null = null
let ExportTraceServiceRequest: protobuf.Type | null = null

const TRACE_SERVICE_PROTO =
  'opentelemetry/proto/collector/trace/v1/trace_service.proto'

function resolveProtoRoot(): string {
  const candidates: string[] = []

  // Most common in local dev/preview
  candidates.push(join(process.cwd(), 'proto'))

  // Walk up from current module location to support bundled server output paths
  let current = __dirname
  for (let i = 0; i < 10; i++) {
    candidates.push(join(current, 'proto'))
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, TRACE_SERVICE_PROTO))) {
      return candidate
    }
  }

  throw new Error(
    `Could not locate OTLP proto root. Tried: ${candidates.join(', ')}`,
  )
}

/**
 * Initialize protobuf types from .proto files
 */
async function initProtobuf() {
  if (root && ExportTraceServiceRequest) {
    return
  }

  // Root directory for proto files - protobufjs will resolve imports from here
  const protoRoot = resolveProtoRoot()

  // Load the main proto file (dependencies are automatically loaded)
  root = new protobuf.Root()
  root.resolvePath = (origin: string, target: string) => {
    // Always resolve imports relative to protoRoot, ignoring origin
    // This is because all OTLP protos use absolute-style imports
    if (target.startsWith('opentelemetry/')) {
      return join(protoRoot, target)
    }
    return target
  }

  await root.load(TRACE_SERVICE_PROTO)
  ExportTraceServiceRequest = root.lookupType(
    'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
  )
}

/**
 * Decode a protobuf OTLP trace request
 * @param buffer - Binary protobuf data
 * @returns Decoded object with resourceSpans array
 */
export async function decodeProtobuf(
  buffer: Uint8Array,
): Promise<{ resourceSpans: any[] }> {
  await initProtobuf()

  if (!ExportTraceServiceRequest) {
    throw new Error('Protobuf types not initialized')
  }

  // Decode the binary buffer
  const message = ExportTraceServiceRequest.decode(buffer)

  // Convert to plain JavaScript object
  const obj = ExportTraceServiceRequest.toObject(message, {
    longs: String, // Convert int64 to string
    enums: String, // Convert enums to string
    bytes: String, // Convert bytes to base64 string (we'll convert to hex later)
    defaults: false, // Don't include default values
    arrays: true, // Always create arrays for repeated fields
    objects: true, // Always create objects for map fields
    oneofs: true, // Include oneof field names
  })

  // Convert byte fields from base64 to hex (OTLP JSON format uses hex)
  convertBytesToHex(obj)

  return obj as { resourceSpans: any[] }
}

/**
 * Recursively convert byte fields from base64 to hex
 * Specifically handles traceId and spanId fields
 */
function convertBytesToHex(obj: any): void {
  if (obj === null || typeof obj !== 'object') {
    return
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    obj.forEach((item) => convertBytesToHex(item))
    return
  }

  // Convert specific byte fields to hex
  for (const key of Object.keys(obj)) {
    const value = obj[key]

    // traceId and spanId are bytes that should be hex-encoded in JSON format
    if (
      (key === 'traceId' || key === 'spanId' || key === 'parentSpanId') &&
      typeof value === 'string'
    ) {
      obj[key] = base64ToHex(value)
    }
    // Handle parentSpanId which might be empty
    else if (key === 'parentSpanId' && value === '') {
      // Keep empty string as is
      continue
    }
    // Recursively process nested objects
    else if (value && typeof value === 'object') {
      convertBytesToHex(value)
    }
  }
}

/**
 * Convert base64 string to hex string
 */
function base64ToHex(base64: string): string {
  if (!base64) {
    return ''
  }

  // Decode base64 to Buffer
  const buffer = Buffer.from(base64, 'base64')

  // Convert to hex string
  return buffer.toString('hex')
}
