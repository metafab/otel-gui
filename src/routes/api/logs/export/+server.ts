import type { RequestHandler } from './$types'
import { traceStore } from '#lib/server/traceStore.js'
import { serializeLogsExport } from '#lib/server/logTransfer.js'

function isValidLogIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function localFileTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const seconds = pad2(date.getSeconds())
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

export const POST: RequestHandler = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON payload' }, { status: 400 })
  }

  const logIds = body?.logIds
  if (!isValidLogIdList(logIds) || logIds.length === 0) {
    return Response.json(
      { error: 'logIds must be a non-empty string array' },
      { status: 400 },
    )
  }

  const logs = Array.from(new Set(logIds))
    .map((logId) => traceStore.getLog(logId))
    .filter((log): log is NonNullable<typeof log> => log != null)

  if (logs.length === 0) {
    return Response.json(
      { error: 'No matching logs found for export' },
      { status: 404 },
    )
  }

  return Response.json(serializeLogsExport(logs), {
    headers: {
      'Content-Disposition': `attachment; filename="logs-${localFileTimestamp(new Date())}.json"`,
    },
  })
}
