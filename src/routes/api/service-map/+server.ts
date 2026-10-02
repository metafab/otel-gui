import { traceStore } from '#lib/server/traceStore.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = ({ url }) => {
  const traceId = url.searchParams.get('traceId') ?? undefined
  const data = traceStore.getServiceMap(traceId)
  return Response.json(data)
}
