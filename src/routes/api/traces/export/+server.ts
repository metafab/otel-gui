import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { serializeTracesExport } from '$lib/server/traceTransfer'

function isValidTraceIdList(value: unknown): value is string[] {
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
  try {
    const body = await request.json()
    const traceIds = body.traceIds

    if (!isValidTraceIdList(traceIds) || traceIds.length === 0) {
      return json(
        { error: 'traceIds must be a non-empty string array' },
        { status: 400 },
      )
    }

    const uniqueTraceIds = Array.from(new Set(traceIds))
    const traces = uniqueTraceIds
      .map((traceId) => traceStore.getTrace(traceId))
      .filter((trace): trace is NonNullable<typeof trace> => trace != null)

    if (traces.length === 0) {
      return json(
        { error: 'No matching traces found for export' },
        { status: 404 },
      )
    }

    const payload = serializeTracesExport(traces)
    const safeTimestamp = localFileTimestamp(new Date())

    return json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="traces-filtered-${safeTimestamp}.json"`,
      },
    })
  } catch {
    return json({ error: 'Malformed JSON payload' }, { status: 400 })
  }
}
