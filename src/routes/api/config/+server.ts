// Returns server-side configuration values needed by the frontend
import type { RequestHandler } from './$types'
import { getPersistenceStatus, traceStore } from '#lib/server/traceStore.js'

export const GET: RequestHandler = async () => {
  return Response.json({
    maxTraces: traceStore.maxTraces,
    maxLogs: traceStore.maxLogs,
    maxMetrics: traceStore.maxMetrics,
    maxMetricPoints: traceStore.maxMetricPoints,
    persistence: getPersistenceStatus(),
  })
}
