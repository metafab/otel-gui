import { describe, it, expect } from 'vitest'
import { findMatchingSpanIds } from './spanSearch'
import type { SpanTreeNode, StoredSpan } from '$lib/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSpan(overrides: Partial<StoredSpan> = {}): StoredSpan {
  return {
    traceId: 'trace1',
    spanId: 'span1',
    parentSpanId: '',
    name: 'test-span',
    kind: 1, // INTERNAL
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    attributes: {},
    events: [],
    links: [],
    status: { code: 0, message: '' },
    resource: { 'service.name': 'my-service' },
    scopeName: 'my-scope',
    scopeVersion: '1.0.0',
    scopeAttributes: {},
    ...overrides,
  }
}

function makeNode(span: StoredSpan): SpanTreeNode {
  return { span, depth: 0, children: [], collapsed: false, subtreeSize: 1 }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('findMatchingSpanIds', () => {
  // ── Blank query ────────────────────────────────────────────────────────────

  it('returns empty Set for empty query', () => {
    const tree = [makeNode(makeSpan())]
    expect(findMatchingSpanIds(tree, '').size).toBe(0)
  })

  it('returns empty Set for whitespace-only query', () => {
    const tree = [makeNode(makeSpan())]
    expect(findMatchingSpanIds(tree, '   ').size).toBe(0)
  })

  // ── Span name ────────────────────────────────────────────────────────────

  it('matches on span name (exact)', () => {
    const span = makeSpan({ spanId: 'a', name: 'HTTP GET /users' })
    const result = findMatchingSpanIds([makeNode(span)], 'HTTP GET /users')
    expect(result).toEqual(new Set(['a']))
  })

  it('matches on span name (substring)', () => {
    const span = makeSpan({ spanId: 'a', name: 'HTTP GET /users' })
    expect(findMatchingSpanIds([makeNode(span)], 'get')).toContain('a')
  })

  it('is case-insensitive for span name', () => {
    const span = makeSpan({ spanId: 'a', name: 'MySpan' })
    expect(findMatchingSpanIds([makeNode(span)], 'myspan')).toContain('a')
  })

  // ── Service name ────────────────────────────────────────────────────────

  it('matches on service name', () => {
    const span = makeSpan({
      spanId: 'a',
      resource: { 'service.name': 'checkout-service' },
    })
    expect(findMatchingSpanIds([makeNode(span)], 'checkout')).toContain('a')
  })

  it('does not match unrelated service name', () => {
    const span = makeSpan({
      spanId: 'a',
      resource: { 'service.name': 'payment-service' },
    })
    expect(findMatchingSpanIds([makeNode(span)], 'checkout')).not.toContain('a')
  })

  // ── Span kind ─────────────────────────────────────────────────────────

  it('matches on span kind label (CLIENT)', () => {
    const span = makeSpan({ spanId: 'a', kind: 3 }) // CLIENT
    expect(findMatchingSpanIds([makeNode(span)], 'client')).toContain('a')
  })

  it('matches on span kind label (SERVER)', () => {
    const span = makeSpan({ spanId: 'a', kind: 2 }) // SERVER
    expect(findMatchingSpanIds([makeNode(span)], 'server')).toContain('a')
  })

  // ── Attributes ────────────────────────────────────────────────────────

  it('matches on attribute key', () => {
    const span = makeSpan({ spanId: 'a', attributes: { 'http.method': 'GET' } })
    expect(findMatchingSpanIds([makeNode(span)], 'http.method')).toContain('a')
  })

  it('matches on attribute value', () => {
    const span = makeSpan({
      spanId: 'a',
      attributes: { 'http.method': 'DELETE' },
    })
    expect(findMatchingSpanIds([makeNode(span)], 'delete')).toContain('a')
  })

  it('matches on numeric attribute value', () => {
    const span = makeSpan({
      spanId: 'a',
      attributes: { 'http.status_code': 500 },
    })
    expect(findMatchingSpanIds([makeNode(span)], '500')).toContain('a')
  })

  // ── Events ───────────────────────────────────────────────────────────

  it('matches on event name', () => {
    const span = makeSpan({
      spanId: 'a',
      events: [{ name: 'exception', timeUnixNano: '1000', attributes: {} }],
    })
    expect(findMatchingSpanIds([makeNode(span)], 'exception')).toContain('a')
  })

  it('matches on event attribute key', () => {
    const span = makeSpan({
      spanId: 'a',
      events: [
        {
          name: 'log',
          timeUnixNano: '1000',
          attributes: { 'exception.type': 'TypeError' },
        },
      ],
    })
    expect(findMatchingSpanIds([makeNode(span)], 'exception.type')).toContain(
      'a',
    )
  })

  it('matches on event attribute value', () => {
    const span = makeSpan({
      spanId: 'a',
      events: [
        {
          name: 'log',
          timeUnixNano: '1000',
          attributes: { level: 'WARN' },
        },
      ],
    })
    expect(findMatchingSpanIds([makeNode(span)], 'warn')).toContain('a')
  })

  // ── Resource attributes ───────────────────────────────────────────────

  it('matches on resource attribute key', () => {
    const span = makeSpan({ spanId: 'a', resource: { 'host.name': 'prod-01' } })
    expect(findMatchingSpanIds([makeNode(span)], 'host.name')).toContain('a')
  })

  it('matches on resource attribute value', () => {
    const span = makeSpan({
      spanId: 'a',
      resource: { 'deployment.environment': 'staging' },
    })
    expect(findMatchingSpanIds([makeNode(span)], 'staging')).toContain('a')
  })

  // ── Scope ─────────────────────────────────────────────────────────────

  it('matches on scopeName', () => {
    const span = makeSpan({ spanId: 'a', scopeName: 'io.opentelemetry.grpc' })
    expect(findMatchingSpanIds([makeNode(span)], 'opentelemetry')).toContain(
      'a',
    )
  })

  it('matches on scopeVersion', () => {
    const span = makeSpan({ spanId: 'a', scopeVersion: '2.5.0' })
    expect(findMatchingSpanIds([makeNode(span)], '2.5.0')).toContain('a')
  })

  it('matches on scope attribute value', () => {
    const span = makeSpan({
      spanId: 'a',
      scopeAttributes: { 'scope.env': 'test-env' },
    })
    expect(findMatchingSpanIds([makeNode(span)], 'test-env')).toContain('a')
  })

  // ── Multiple spans ────────────────────────────────────────────────────

  it('returns all matching spans from a tree', () => {
    const spanA = makeSpan({ spanId: 'a', name: 'matching-op' })
    const spanB = makeSpan({ spanId: 'b', name: 'other-op' })
    const spanC = makeSpan({ spanId: 'c', name: 'also-matching-op' })
    const result = findMatchingSpanIds(
      [makeNode(spanA), makeNode(spanB), makeNode(spanC)],
      'matching',
    )
    expect(result).toEqual(new Set(['a', 'c']))
  })

  it('returns empty Set when no spans match', () => {
    const span = makeSpan({ spanId: 'a', name: 'unrelated' })
    expect(findMatchingSpanIds([makeNode(span)], 'xyz-no-match').size).toBe(0)
  })

  it('handles an empty span tree', () => {
    expect(findMatchingSpanIds([], 'anything').size).toBe(0)
  })
})
