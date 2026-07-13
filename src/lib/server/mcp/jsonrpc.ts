// Minimal MCP (Model Context Protocol) server over JSON-RPC 2.0.
//
// otel-gui's MCP is read-only, stateless, and localhost-only, so it needs none
// of the SDK's session/streaming machinery: a client POSTs a JSON-RPC request
// and gets a single JSON response back. We implement just the methods that a
// tools-only server must answer — initialize, tools/list, tools/call, ping —
// plus no-op handling for notifications. Tool defs are SDK-shaped so swapping in
// @modelcontextprotocol/sdk later would be mechanical.

import type { TraceStore } from '$lib/types'
import { createMcpTools, type McpTool } from './tools'

const SERVER_INFO = { name: 'otel-gui', version: '2.0.0' }
// Newest MCP revision we implement; used when the client omits/!supports one.
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

// Standard JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: string
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function publicTool(tool: McpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }
}

// Wrap a handler's return value as an MCP tool result: a text block (JSON) plus
// structuredContent for clients that consume it directly.
function toToolResult(value: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

function errorToolResult(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

export interface McpDispatcher {
  // Returns the response(s), or null when the payload was purely notifications
  // (which get no reply per JSON-RPC).
  (payload: unknown): JsonRpcResponse | JsonRpcResponse[] | null
}

export function createMcpDispatcher(store: TraceStore): McpDispatcher {
  const tools = createMcpTools(store)
  const toolsByName = new Map(tools.map((t) => [t.name, t]))

  function handleOne(message: JsonRpcRequest): JsonRpcResponse | null {
    const isNotification = !('id' in message)
    const id = isNotification ? null : (message.id as JsonRpcId)

    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Can't reply to a malformed notification.
      return isNotification
        ? null
        : fail(id, INVALID_REQUEST, 'Invalid Request')
    }

    // Notifications (e.g. notifications/initialized) are fire-and-forget.
    if (isNotification) return null

    switch (message.method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion
        return ok(id, {
          protocolVersion:
            typeof requested === 'string'
              ? requested
              : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools: tools.map(publicTool) })
      case 'tools/call': {
        const name = asString(message.params?.name)
        if (!name) return fail(id, INVALID_PARAMS, 'Missing tool name')
        const tool = toolsByName.get(name)
        if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`)
        const args = (message.params?.arguments ?? {}) as Record<
          string,
          unknown
        >
        try {
          return ok(id, toToolResult(tool.handler(args)))
        } catch (error) {
          // Tool-level failures are reported inside the result (isError), not as
          // a protocol error, per MCP conventions.
          const msg = error instanceof Error ? error.message : String(error)
          return ok(id, errorToolResult(msg))
        }
      }
      default:
        return fail(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`)
    }
  }

  return (payload: unknown) => {
    if (Array.isArray(payload)) {
      const responses = payload
        .map((entry) => handleOne(entry as JsonRpcRequest))
        .filter((r): r is JsonRpcResponse => r !== null)
      return responses.length > 0 ? responses : null
    }
    return handleOne(payload as JsonRpcRequest)
  }
}

// Local (dispatcher-only) string coercion — kept separate from tools.ts helpers
// to avoid a cross-module import just for one guard.
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const PARSE_ERROR_CODE = PARSE_ERROR
