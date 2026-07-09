// MCP (Model Context Protocol) endpoint — lets an agent search and fetch the
// telemetry otel-gui holds in memory, the same way the Grafana MCP works against
// cloud backends.
//
// Transport: JSON-RPC 2.0 over a single POST (MCP "Streamable HTTP" without the
// optional server-push SSE channel). The server is read-only and stateless, so
// no sessions are tracked.
//
// Security: loopback-only by DEFAULT — suited to the bare binary on a
// workstation, where the co-located agent connects over 127.0.0.1. It is NOT a
// hard boundary: the rest of the app (`/api` reads, `/v1` ingest) is already
// unauthenticated with CORS `*`, so anyone who can reach the port reads the same
// data. The guard's job is only to avoid accidentally answering non-local
// callers by default.
//
// In a container (or behind a proxy) the request arrives via the Docker bridge /
// proxy, so `getClientAddress()` returns the gateway address, not loopback — the
// loopback guard would then reject even host-side calls (the classic
// `-p 4318:4318` case). Set OTEL_GUI_MCP_ALLOW_REMOTE=1 in those deployments,
// where exposure is controlled at the network / port-mapping layer.
//
// Set OTEL_GUI_MCP_ENABLED=0 to turn the endpoint off entirely.
import { json, text } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import type { RequestHandler } from './$types'
import { traceStore } from '$lib/server/traceStore'
import { createMcpDispatcher, PARSE_ERROR_CODE } from '$lib/server/mcp/jsonrpc'

// Tools close over the singleton store (live reads), so build the dispatcher
// once for the process rather than per request.
const dispatch = createMcpDispatcher(traceStore)

function isEnabled(): boolean {
  const raw = env.OTEL_GUI_MCP_ENABLED
  if (raw === undefined || raw === '') return true
  return raw !== '0' && raw.toLowerCase() !== 'false'
}

// When true, skip the loopback check — for container/proxy deployments where the
// real client address is hidden behind a gateway and exposure is controlled at
// the network layer. Default false (loopback-only).
function allowRemote(): boolean {
  const raw = env.OTEL_GUI_MCP_ALLOW_REMOTE
  if (raw === undefined || raw === '') return false
  return raw === '1' || raw.toLowerCase() === 'true'
}

// Loopback addresses only. Covers IPv4, IPv6, and IPv4-mapped IPv6 forms.
function isLoopback(address: string): boolean {
  if (address === '127.0.0.1' || address === '::1' || address === 'localhost') {
    return true
  }
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = address.replace(/^::ffff:/i, '')
  return mapped.startsWith('127.')
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  if (!isEnabled()) {
    return json({ error: 'MCP endpoint is disabled' }, { status: 404 })
  }

  let clientAddress: string
  try {
    clientAddress = getClientAddress()
  } catch {
    clientAddress = ''
  }
  if (!allowRemote() && !isLoopback(clientAddress)) {
    return json(
      {
        error:
          'MCP endpoint is restricted to localhost. Set OTEL_GUI_MCP_ALLOW_REMOTE=1 to allow non-loopback clients (e.g. when running in Docker or behind a proxy).',
      },
      { status: 403 },
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    // JSON-RPC parse error — id is unknowable, so null.
    return json({
      jsonrpc: '2.0',
      id: null,
      error: { code: PARSE_ERROR_CODE, message: 'Parse error' },
    })
  }

  const response = dispatch(payload)

  // Notifications only → nothing to return (202 Accepted, empty body).
  if (response === null) {
    return text('', { status: 202 })
  }

  return json(response)
}

// The server never initiates streams, so the optional GET (SSE) channel is
// unsupported. Advertise POST so clients fall back to request/response mode.
export const GET: RequestHandler = async () => {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  })
}
