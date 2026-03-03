import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async () => {
  return json(
    { error: 'OTLP metrics ingestion is not implemented yet' },
    { status: 501 },
  )
}
