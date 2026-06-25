import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'

export const GET: RequestHandler = async ({ params }) => {
  const { metricId } = params
  // getMetricDetail flattens the series Map to an array and, for cumulative/
  // delta Sums, attaches a server-computed per-second `rate` to each point.
  // Other metric types carry their type-appropriate point shape unchanged
  // (histogram buckets/bounds, exp-histogram scaled buckets, summary quantiles).
  const detail = traceStore.getMetricDetail(metricId)

  if (!detail) {
    throw error(404, 'Metric not found')
  }

  return json(detail)
}
