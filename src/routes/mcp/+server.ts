import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  OTEL_GUI_MCP_ALLOW_REMOTE,
  OTEL_GUI_MCP_ENABLED,
} from '$app/env/private'
import type { RequestHandler } from './$types'
import { traceStore } from '#lib/server/traceStore.js'
import { createMcpServer } from '#lib/server/mcp/server.js'
import {
  allowsRemoteMcp,
  isLoopbackAddress,
  mcpIsEnabled,
} from '#lib/server/mcp/access.js'

async function handleMcpRequest(
  request: Request,
  getClientAddress: () => string,
): Promise<Response> {
  if (!mcpIsEnabled(OTEL_GUI_MCP_ENABLED)) {
    return Response.json({ error: 'MCP endpoint is disabled' }, { status: 404 })
  }

  let clientAddress = ''
  try {
    clientAddress = getClientAddress()
  } catch {
    // An unknown client address must not bypass the loopback-only default.
  }
  if (
    !allowsRemoteMcp(OTEL_GUI_MCP_ALLOW_REMOTE) &&
    !isLoopbackAddress(clientAddress)
  ) {
    return Response.json(
      {
        error:
          'MCP is restricted to loopback clients. Set OTEL_GUI_MCP_ALLOW_REMOTE=1 only when remote exposure is protected by your network.',
      },
      { status: 403 },
    )
  }

  const server = createMcpServer(traceStore)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export const POST: RequestHandler = ({ request, getClientAddress }) =>
  handleMcpRequest(request, getClientAddress)

export const GET: RequestHandler = ({ request, getClientAddress }) =>
  handleMcpRequest(request, getClientAddress)

export const DELETE: RequestHandler = ({ request, getClientAddress }) =>
  handleMcpRequest(request, getClientAddress)
