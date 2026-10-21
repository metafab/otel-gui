import type { RequestHandler } from './$types'
import { traceStore } from '#lib/server/traceStore.js'
import { parseLogImportPayload } from '#lib/server/logTransfer.js'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json()
    const content = typeof body.content === 'string' ? body.content : null
    const fileName = typeof body.fileName === 'string' ? body.fileName : null

    if (!content) {
      return Response.json(
        { error: 'Import payload content is required' },
        { status: 400 },
      )
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8')
    if (sizeBytes > MAX_IMPORT_BYTES) {
      return Response.json(
        { error: `Import file exceeds ${MAX_IMPORT_BYTES} bytes limit` },
        { status: 400 },
      )
    }

    let parsedContent: unknown
    try {
      parsedContent = JSON.parse(content)
    } catch {
      return Response.json({ error: 'Malformed JSON payload' }, { status: 400 })
    }

    const parsed = parseLogImportPayload(parsedContent, {
      fileName,
      sizeBytes,
      existingLogCount: traceStore.getLogCount(),
      maxLogs: traceStore.maxLogs,
    })

    traceStore.ingestLogs(parsed.resourceLogs)

    return Response.json({
      importedLogCount: parsed.preview.logCount,
      warnings: parsed.preview.warnings,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not import logs'
    return Response.json({ error: message }, { status: 400 })
  }
}
