import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  return json({ error: 'Metrics endpoint is not implemented yet' }, { status: 501 })
}
