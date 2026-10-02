import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  return Response.json(
    { error: 'Metrics endpoint is not implemented yet' },
    { status: 501 },
  )
}
