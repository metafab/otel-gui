import { describe, it, expect } from 'vitest'
import {
  buildCorsHeaders,
  isCorsEnabledPath,
  parseAllowedOrigins,
  resolveAllowOrigin,
} from './cors'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:4318/v1/traces', {
    method: 'OPTIONS',
    headers,
  })
}

describe('isCorsEnabledPath', () => {
  it('matches OTLP ingest and read API routes', () => {
    expect(isCorsEnabledPath('/v1/traces')).toBe(true)
    expect(isCorsEnabledPath('/v1/metrics')).toBe(true)
    expect(isCorsEnabledPath('/api/traces')).toBe(true)
  })

  it('does not match app/page routes', () => {
    expect(isCorsEnabledPath('/')).toBe(false)
    expect(isCorsEnabledPath('/traces/abc')).toBe(false)
    expect(isCorsEnabledPath('/v1')).toBe(false)
  })
})

describe('parseAllowedOrigins', () => {
  it('treats unset, empty, and "*" as wildcard', () => {
    expect(parseAllowedOrigins(undefined)).toBe('*')
    expect(parseAllowedOrigins('')).toBe('*')
    expect(parseAllowedOrigins('   ')).toBe('*')
    expect(parseAllowedOrigins('*')).toBe('*')
  })

  it('parses a comma-separated allow-list, trimming blanks', () => {
    expect(
      parseAllowedOrigins('https://a.example, https://b.example ,'),
    ).toEqual(['https://a.example', 'https://b.example'])
  })
})

describe('resolveAllowOrigin', () => {
  it('returns the wildcard regardless of request origin when unrestricted', () => {
    expect(resolveAllowOrigin('https://app.example', undefined)).toBe('*')
    expect(resolveAllowOrigin(null, '*')).toBe('*')
  })

  it('echoes an allowed origin', () => {
    expect(
      resolveAllowOrigin('https://app.example', 'https://app.example'),
    ).toBe('https://app.example')
  })

  it('rejects an origin not on the allow-list', () => {
    expect(
      resolveAllowOrigin('https://evil.example', 'https://app.example'),
    ).toBeNull()
  })

  it('rejects when the allow-list is set but the request has no origin', () => {
    expect(resolveAllowOrigin(null, 'https://app.example')).toBeNull()
  })
})

describe('buildCorsHeaders', () => {
  it('emits wildcard CORS headers by default', () => {
    const headers = buildCorsHeaders(
      makeRequest({ origin: 'https://app.example' }),
      undefined,
    )
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(headers.get('Access-Control-Max-Age')).toBe('86400')
    // No Vary when wildcard.
    expect(headers.get('Vary')).toBeNull()
  })

  it('echoes an allowed origin and sets Vary: Origin', () => {
    const headers = buildCorsHeaders(
      makeRequest({ origin: 'https://app.example' }),
      'https://app.example',
    )
    expect(headers.get('Access-Control-Allow-Origin')).toBe(
      'https://app.example',
    )
    expect(headers.get('Vary')).toBe('Origin')
  })

  it('reflects the requested preflight headers', () => {
    const headers = buildCorsHeaders(
      makeRequest({
        origin: 'https://app.example',
        'access-control-request-headers': 'content-type,x-custom',
      }),
      undefined,
    )
    expect(headers.get('Access-Control-Allow-Headers')).toBe(
      'content-type,x-custom',
    )
  })

  it('falls back to the default header set when none are requested', () => {
    const headers = buildCorsHeaders(
      makeRequest({ origin: 'https://app.example' }),
      undefined,
    )
    expect(headers.get('Access-Control-Allow-Headers')).toContain(
      'Content-Type',
    )
  })

  it('emits no headers when the origin is not allowed', () => {
    const headers = buildCorsHeaders(
      makeRequest({ origin: 'https://evil.example' }),
      'https://app.example',
    )
    expect([...headers.keys()]).toHaveLength(0)
  })
})
