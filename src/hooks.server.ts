import type { Handle, ServerInit } from '@sveltejs/kit/hooks'
import {
  OTEL_GUI_CORS_ALLOWED_ORIGINS,
  OTEL_GUI_GRPC_ENABLED,
  OTEL_GUI_GRPC_HOST,
  OTEL_GUI_GRPC_PORT,
} from '$app/env/private'
import { buildCorsHeaders, shouldApplyCorsToPath } from '#lib/server/cors.js'
import { startGrpcReceiver } from '#lib/server/grpc.js'
import { traceStore } from '#lib/server/traceStore.js'

// Start the OTLP/gRPC receiver (port 4317 by default) alongside the HTTP server.
export const init: ServerInit = () => {
  startGrpcReceiver({
    enabled: OTEL_GUI_GRPC_ENABLED,
    port: OTEL_GUI_GRPC_PORT,
    host: OTEL_GUI_GRPC_HOST,
    getIngest: () => traceStore,
  })
}

// Apply CORS to the OTLP ingest and read API endpoints so browser-based OTLP
// exporters (and dashboards) can reach the server cross-origin. The allowed
// origin(s) are configured via OTEL_GUI_CORS_ALLOWED_ORIGINS (default: any origin).
export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event
  const corsEnabled = shouldApplyCorsToPath(event.url.pathname)

  // Answer CORS preflight requests directly — SvelteKit has no OPTIONS handler
  // for these routes, so without this a preflight would 405 and the browser
  // would never send the real request.
  if (corsEnabled && request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request, OTEL_GUI_CORS_ALLOWED_ORIGINS),
    })
  }

  const response = await resolve(event)

  if (corsEnabled) {
    const corsHeaders = buildCorsHeaders(request, OTEL_GUI_CORS_ALLOWED_ORIGINS)

    corsHeaders.forEach((value, key) => {
      // Vary is additive — append so we don't clobber any existing value.
      if (key === 'vary') response.headers.append('Vary', value)
      else response.headers.set(key, value)
    })
  }

  return response
}
