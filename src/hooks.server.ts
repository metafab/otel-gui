import { env } from '$env/dynamic/private'
import type { Handle } from '@sveltejs/kit'
import { buildCorsHeaders, isCorsEnabledPath } from '$lib/server/cors'

// Apply CORS to the OTLP ingest and read API endpoints so browser-based OTLP
// exporters (and dashboards) can reach the server cross-origin. The allowed
// origin(s) are configured via OTEL_GUI_CORS_ORIGIN (default: any origin).
export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event
  const corsEnabled = isCorsEnabledPath(event.url.pathname)

  // Answer CORS preflight requests directly — SvelteKit has no OPTIONS handler
  // for these routes, so without this a preflight would 405 and the browser
  // would never send the real request.
  if (corsEnabled && request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request, env.OTEL_GUI_CORS_ORIGIN),
    })
  }

  const response = await resolve(event)

  if (corsEnabled) {
    const corsHeaders = buildCorsHeaders(request, env.OTEL_GUI_CORS_ORIGIN)
    corsHeaders.forEach((value, key) => {
      // Vary is additive — append so we don't clobber any existing value.
      if (key === 'vary') response.headers.append('Vary', value)
      else response.headers.set(key, value)
    })
  }

  return response
}
