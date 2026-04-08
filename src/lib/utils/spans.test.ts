import { describe, it, expect } from 'vitest'
import { buildSpanTree, spanKindLabel, statusLabel } from '$lib/utils/spans'
import type { StoredSpan } from '$lib/types'

// Helper to create a minimal StoredSpan
function makeSpan(
  overrides: Partial<StoredSpan> & {
    spanId: string
    parentSpanId: string
    name: string
  },
): StoredSpan {
  return {
    traceId: 'TRACE001',
    spanId: overrides.spanId,
    parentSpanId: overrides.parentSpanId,
    name: overrides.name,
    kind: overrides.kind ?? 1,
    startTimeUnixNano: overrides.startTimeUnixNano ?? '1000000000',
    endTimeUnixNano: overrides.endTimeUnixNano ?? '2000000000',
    attributes: overrides.attributes ?? {},
    events: overrides.events ?? [],
    links: overrides.links ?? [],
    status: overrides.status ?? { code: 0, message: '' },
    resource: overrides.resource ?? {},
    scopeName: overrides.scopeName ?? '',
    scopeVersion: overrides.scopeVersion ?? '',
    scopeAttributes: overrides.scopeAttributes ?? {},
  }
}

describe('spanKindLabel', () => {
  const cases: [number, string][] = [
    [0, 'UNSPECIFIED'],
    [1, 'INTERNAL'],
    [2, 'SERVER'],
    [3, 'CLIENT'],
    [4, 'PRODUCER'],
    [5, 'CONSUMER'],
    [99, 'UNKNOWN'],
  ]

  for (const [kind, label] of cases) {
    it(`returns "${label}" for kind ${kind}`, () => {
      expect(spanKindLabel(kind)).toBe(label)
    })
  }
})

describe('statusLabel', () => {
  const cases: [number, string][] = [
    [0, 'UNSET'],
    [1, 'OK'],
    [2, 'ERROR'],
    [99, 'UNKNOWN'],
  ]

  for (const [code, label] of cases) {
    it(`returns "${label}" for code ${code}`, () => {
      expect(statusLabel(code)).toBe(label)
    })
  }
})

describe('buildSpanTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildSpanTree([])).toEqual([])
  })

  it('builds a single root span', () => {
    const root = makeSpan({ spanId: 'root', parentSpanId: '', name: 'root-op' })
    const tree = buildSpanTree([root])

    expect(tree).toHaveLength(1)
    expect(tree[0].span.spanId).toBe('root')
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toHaveLength(0)
    expect(tree[0].subtreeSize).toBe(0)
  })

  it('builds a parent-child hierarchy', () => {
    const root = makeSpan({
      spanId: 'root',
      parentSpanId: '',
      name: 'root-op',
      startTimeUnixNano: '1000',
    })
    const child = makeSpan({
      spanId: 'child',
      parentSpanId: 'root',
      name: 'child-op',
      startTimeUnixNano: '2000',
    })
    const tree = buildSpanTree([root, child])

    expect(tree).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].span.spanId).toBe('child')
    expect(tree[0].children[0].depth).toBe(1)
    expect(tree[0].subtreeSize).toBe(1)
  })

  it('places orphan spans under a phantom (missing) parent node', () => {
    // child references a parent that's not in the list → phantom node wraps it
    const orphan = makeSpan({
      spanId: 'orphan',
      parentSpanId: 'missing-parent',
      name: 'orphan-op',
    })
    const tree = buildSpanTree([orphan])

    expect(tree).toHaveLength(1)
    expect(tree[0].isPhantom).toBe(true)
    expect(tree[0].span.spanId).toBe('missing-parent')
    expect(tree[0].span.name).toBe('(missing)')
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].span.spanId).toBe('orphan')
    expect(tree[0].children[0].depth).toBe(1)
  })

  it('handles multi-level nesting', () => {
    const root = makeSpan({
      spanId: 'a',
      parentSpanId: '',
      name: 'a',
      startTimeUnixNano: '1000',
    })
    const b = makeSpan({
      spanId: 'b',
      parentSpanId: 'a',
      name: 'b',
      startTimeUnixNano: '2000',
    })
    const c = makeSpan({
      spanId: 'c',
      parentSpanId: 'b',
      name: 'c',
      startTimeUnixNano: '3000',
    })
    const tree = buildSpanTree([root, b, c])

    expect(tree[0].subtreeSize).toBe(2)
    expect(tree[0].children[0].children[0].span.spanId).toBe('c')
    expect(tree[0].children[0].children[0].depth).toBe(2)
  })

  it('sorts children by start time', () => {
    const root = makeSpan({
      spanId: 'root',
      parentSpanId: '',
      name: 'root',
      startTimeUnixNano: '1000',
    })
    const c1 = makeSpan({
      spanId: 'c1',
      parentSpanId: 'root',
      name: 'c1',
      startTimeUnixNano: '3000',
    })
    const c2 = makeSpan({
      spanId: 'c2',
      parentSpanId: 'root',
      name: 'c2',
      startTimeUnixNano: '2000',
    })
    const tree = buildSpanTree([root, c1, c2])

    // c2 starts earlier → should come first
    expect(tree[0].children[0].span.spanId).toBe('c2')
    expect(tree[0].children[1].span.spanId).toBe('c1')
  })

  it('handles multiple root spans sorted by start time', () => {
    const r1 = makeSpan({
      spanId: 'r1',
      parentSpanId: '',
      name: 'r1',
      startTimeUnixNano: '2000',
    })
    const r2 = makeSpan({
      spanId: 'r2',
      parentSpanId: '',
      name: 'r2',
      startTimeUnixNano: '1000',
    })
    const tree = buildSpanTree([r1, r2])

    expect(tree).toHaveLength(2)
    expect(tree[0].span.spanId).toBe('r2')
    expect(tree[1].span.spanId).toBe('r1')
  })

  it('does not infinite-loop on circular references', () => {
    // a → b → a (circular)
    const a = makeSpan({
      spanId: 'a',
      parentSpanId: 'b',
      name: 'a',
      startTimeUnixNano: '1000',
    })
    const b = makeSpan({
      spanId: 'b',
      parentSpanId: 'a',
      name: 'b',
      startTimeUnixNano: '2000',
    })
    // Both are orphans since their parents resolve to each other but neither has '' parentSpanId.
    // The buildSpanTree logic will treat one of them as root (orphan promotion).
    expect(() => buildSpanTree([a, b])).not.toThrow()
  })
})
