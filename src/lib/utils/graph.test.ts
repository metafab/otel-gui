import { describe, expect, it } from 'vitest'
import { layoutGraph } from './graph'
import type { ServiceMapNode, ServiceMapEdge } from '$lib/types'

function makeNode(serviceName: string): ServiceMapNode {
  return {
    serviceName,
    nodeType: 'service',
    spanCount: 1,
    errorCount: 0,
  }
}

function makeEdge(source: string, target: string): ServiceMapEdge {
  return {
    source,
    target,
    callCount: 1,
    errorCount: 0,
    durations: [1_000_000],
    p50Ms: 1,
    p99Ms: 1,
  }
}

describe(layoutGraph, () => {
  it('handles a 3-node cycle without unbounded layering', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')]
    const edges = [
      makeEdge('a', 'b'),
      makeEdge('b', 'c'),
      makeEdge('c', 'a'),
    ]

    const layout = layoutGraph(nodes, edges)

    expect(layout.nodes).toHaveLength(3)
    expect(layout.edges).toHaveLength(3)
    // Max layer is capped at nodeCount - 1, so max width is bounded.
    expect(layout.viewWidth).toBeLessThanOrEqual(580)
    expect(layout.viewHeight).toBeGreaterThan(0)
  })

  it('handles a self-cycle without growing the layout infinitely', () => {
    const nodes = [makeNode('solo')]
    const edges = [makeEdge('solo', 'solo')]

    const layout = layoutGraph(nodes, edges)

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(1)
    expect(layout.viewWidth).toBe(140)
    expect(layout.viewHeight).toBe(52)
  })
})
