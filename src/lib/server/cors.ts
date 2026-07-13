// Cross-Origin Resource Sharing (CORS) helpers for the OTLP ingest and read
// API endpoints.
//
// Browser-based OTLP exporters (front-end telemetry) issue cross-origin
// requests to this server. Anything beyond a "simple" request — e.g. an
// `application/x-protobuf` body or a custom header — triggers a CORS preflight
// (`OPTIONS`) that SvelteKit does not answer on its own, and every actual
// response needs an `Access-Control-Allow-Origin` header or the browser
// discards it. These helpers centralise that policy; `hooks.server.ts` wires
// them into the request pipeline.
//
// Allowed origins are controlled by the `OTEL_GUI_CORS_ALLOWED_ORIGINS` env
// var:
//   - unset / empty / "*"         → allow any origin (default; zero-config)
//   - comma-separated origin list → allow only those exact origins
//
// The functions here are pure (the env value is passed in), so they can be
// unit-tested without mocking the SvelteKit env module.

/**
 * Returns `true` for routes that should receive CORS handling: OTLP ingest (`/v1/*`) and read API (`/api/*`).
 */
export function shouldApplyCorsToPath(pathname: string): boolean {
  return pathname.startsWith('/v1/') || pathname.startsWith('/api/')
}

/**
 * Parses `OTEL_GUI_CORS_ALLOWED_ORIGINS` into either wildcard access or an explicit allow-list.
 * Empty values and `'*'` are treated as wildcard.
 *
 * @param raw The raw env var value.
 *
 * @returns `'*'` for unrestricted access, or the parsed allowed origins list.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] | '*' {
  if (raw === undefined) return '*'
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*') return '*'
  const list = trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
  return list.length > 0 ? list : '*'
}

/**
 * Resolves the `Access-Control-Allow-Origin` value for a request.
 *
 * @param requestOrigin The origin of the incoming request, or `null` if the request has no `Origin` header.
 * @param raw The raw env var value for allowed origins.
 *
 * @returns `'*'` when all origins are allowed, the request origin when it is
 * allowed, or `null` when the origin is not allowed.
 */
export function resolveAllowOrigin(
  requestOrigin: string | null,
  raw: string | undefined,
): string | null {
  const allowed = parseAllowedOrigins(raw)
  if (allowed === '*') return '*'
  if (requestOrigin !== null && allowed.includes(requestOrigin)) {
    return requestOrigin
  }
  return null
}

/**
 * Headers we permit when a browser does not pre-declare them via the preflight
 * `Access-Control-Request-Headers` header (covers the common OTLP exporter set).
 */
const DEFAULT_ALLOWED_HEADERS =
  'Content-Type, Content-Encoding, Authorization, X-Requested-With'

/**
 * Builds the CORS response headers for an actual request or a preflight response.
 *
 * @param request The incoming request.
 * @param raw The raw env var value for allowed origins.
 *
 * @returns A `Headers` object containing CORS headers, or an empty `Headers`
 * object when the request origin is not allowed.
 */
export function buildCorsHeaders(
  request: Request,
  raw: string | undefined,
): Headers {
  const headers = new Headers()
  const allowOrigin = resolveAllowOrigin(request.headers.get('origin'), raw)
  if (allowOrigin === null) return headers

  headers.set('Access-Control-Allow-Origin', allowOrigin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')

  // Reflect the headers the browser asked for in its preflight; otherwise fall
  // back to the common OTLP exporter set.
  const requested = request.headers.get('access-control-request-headers')
  const allowHeaders =
    requested && requested.trim() !== '' ? requested : DEFAULT_ALLOWED_HEADERS
  headers.set('Access-Control-Allow-Headers', allowHeaders)
  // Cache safety: preflight responses vary by requested headers, and non-wildcard
  // origin policies also vary by Origin.
  const varyParts: string[] = []
  if (allowOrigin !== '*') varyParts.push('Origin')
  if (requested && requested.trim() !== '') {
    varyParts.push('Access-Control-Request-Headers')
  }
  if (varyParts.length > 0) headers.set('Vary', varyParts.join(', '))
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}
