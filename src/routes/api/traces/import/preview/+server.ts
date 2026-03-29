import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { parseTraceImportPayload } from '$lib/server/traceTransfer'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json()
    const content = typeof body.content === 'string' ? body.content : null
    const fileName = typeof body.fileName === 'string' ? body.fileName : null

    if (!content) {
      return json(
        { error: 'Import payload content is required' },
        { status: 400 },
      )
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8')
    if (sizeBytes > MAX_IMPORT_BYTES) {
      return json(
        { error: `Import file exceeds ${MAX_IMPORT_BYTES} bytes limit` },
        { status: 400 },
      )
    }

    let parsedContent: unknown
    try {
      parsedContent = JSON.parse(content)
    } catch {
      return json({ error: 'Malformed JSON payload' }, { status: 400 })
    }

    const existingTraceIds = new Set(
      traceStore
        .getTraceList(traceStore.maxTraces)
        .map((trace) => trace.traceId),
    )
    const parsed = parseTraceImportPayload(parsedContent, {
      fileName,
      sizeBytes,
      existingTraceIds,
      maxTraces: traceStore.maxTraces,
    })

    return json(parsed.preview)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not preview import file'
    return json({ error: message }, { status: 400 })
  }
}
