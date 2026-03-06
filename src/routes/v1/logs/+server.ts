import { json } from '@sveltejs/kit'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { decodeProtobufLogs } from '$lib/server/protobuf'

const gunzipAsync = promisify(gunzip)

export const POST: RequestHandler = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || ''
    const contentEncoding = request.headers.get('content-encoding') || ''

    const arrayBuffer = await request.arrayBuffer()
    let buffer = new Uint8Array(arrayBuffer)

    if (contentEncoding.includes('gzip')) {
      try {
        buffer = new Uint8Array(await gunzipAsync(buffer))
      } catch {
        return json({ error: 'Malformed gzip payload' }, { status: 400 })
      }
    }

    let body: { resourceLogs: any[] }

    if (
      contentType.includes('application/x-protobuf') ||
      contentType.includes('application/protobuf')
    ) {
      try {
        body = await decodeProtobufLogs(buffer)
      } catch {
        return json({ error: 'Malformed protobuf payload' }, { status: 400 })
      }
    } else if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(new TextDecoder().decode(buffer))
      } catch {
        return json({ error: 'Malformed JSON payload' }, { status: 400 })
      }
    } else {
      return json(
        {
          error:
            'Unsupported Content-Type. Expected application/json or application/x-protobuf.',
        },
        { status: 400 },
      )
    }

    if (!body.resourceLogs) {
      return json(
        { error: 'Invalid OTLP payload: missing resourceLogs' },
        { status: 400 },
      )
    }

    traceStore.ingestLogs(body.resourceLogs)

    return json({}, { status: 200 })
  } catch (error) {
    console.error('Error processing OTLP logs request:', error)
    return json(
      { error: 'Internal server error processing logs' },
      { status: 500 },
    )
  }
}
