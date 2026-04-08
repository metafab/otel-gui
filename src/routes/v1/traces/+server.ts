// OTLP/HTTP receiver endpoint
import { json } from '@sveltejs/kit'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { decodeProtobuf } from '$lib/server/protobuf'

const gunzipAsync = promisify(gunzip)

export const POST: RequestHandler = async ({ request }) => {
  try {
    console.log('Received OTLP trace request')
    const contentType = request.headers.get('content-type') || ''
    const contentEncoding = request.headers.get('content-encoding') || ''

    // Read raw bytes once
    const arrayBuffer = await request.arrayBuffer()
    let buffer = new Uint8Array(arrayBuffer)

    // Decompress gzip if needed
    if (contentEncoding.includes('gzip')) {
      try {
        buffer = new Uint8Array(await gunzipAsync(buffer))
      } catch {
        return json({ error: 'Malformed gzip payload' }, { status: 400 })
      }
    }

    let body: { resourceSpans: any[] }

    // Handle Protobuf format
    if (
      contentType.includes('application/x-protobuf') ||
      contentType.includes('application/protobuf')
    ) {
      try {
        body = await decodeProtobuf(buffer)
      } catch {
        return json({ error: 'Malformed protobuf payload' }, { status: 400 })
      }
    }
    // Handle JSON format
    else if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(new TextDecoder().decode(buffer))
      } catch {
        return json({ error: 'Malformed JSON payload' }, { status: 400 })
      }
    }
    // Unsupported content type
    else {
      return json(
        {
          error:
            'Unsupported Content-Type. Expected application/json or application/x-protobuf.',
        },
        { status: 400 },
      )
    }

    // Validate basic structure
    if (!body.resourceSpans) {
      return json(
        { error: 'Invalid OTLP payload: missing resourceSpans' },
        { status: 400 },
      )
    }

    console.log(`Ingesting ${body.resourceSpans.length} resource spans from OTLP request`, new Date().toISOString())
    // Ingest spans
    traceStore.ingest(body.resourceSpans)

    // Return successful response (empty is valid)
    return json({}, { status: 200 })
  } catch (error) {
    console.error('Error processing OTLP request:', error)
    return json(
      { error: 'Internal server error processing traces' },
      { status: 500 },
    )
  }
}
