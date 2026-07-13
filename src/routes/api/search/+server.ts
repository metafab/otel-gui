// Unified deep-search endpoint for the UI (and any other read client).
//
// Backs the front-end search box: a case-insensitive substring query run
// server-side across traces, logs, and metrics — matching message bodies, span
// names, status, and every attribute — so a search finds values the streamed
// list items don't carry (attributes live only in the full records). Reuses the
// exact store methods the MCP endpoint uses, so behaviour stays in one place.
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import type { SearchKind } from '$lib/types'

const VALID_KINDS: SearchKind[] = ['traces', 'logs', 'metrics']
// Upper bound on any single kind's result set (matches the store's own guard
// intent); the store default (200) applies when no limit is given.
const MAX_LIMIT = 1000

function parseKinds(raw: string | null): SearchKind[] | undefined {
  if (!raw) return undefined
  const kinds = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is SearchKind => VALID_KINDS.includes(k as SearchKind))
  return kinds.length > 0 ? kinds : undefined
}

function parseLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, MAX_LIMIT)
}

export const GET: RequestHandler = async ({ url }) => {
  if (typeof traceStore.searchAll !== 'function') {
    return json(
      { error: 'Search is not supported by this storage backend' },
      { status: 501 },
    )
  }

  const query = (url.searchParams.get('q') ?? '').trim()
  const service = url.searchParams.get('service') || undefined
  const kinds = parseKinds(url.searchParams.get('kinds'))
  const limit = parseLimit(url.searchParams.get('limit'))

  // A bare request (no query, no service) has nothing to narrow on — return
  // empties rather than dumping the whole corpus. The UI shows the streamed
  // list in that case instead of calling this endpoint.
  if (query === '' && service === undefined) {
    return json({ traces: [], logs: [], metrics: [] })
  }

  return json(traceStore.searchAll({ query, kinds, service, limit }))
}
