/**
 * Layered (hierarchical) graph layout for the service map.
 * Simplified Sugiyama-style: layer assignment → barycenter ordering → coordinate assignment.
 * Returns positioned nodes and bezier edge paths — no external dependencies.
 */

import type { ServiceMapNode, ServiceMapEdge } from '$lib/types'

export interface LayoutNode {
  serviceName: string
  nodeType: ServiceMapNode['nodeType']
  system?: string
  spanCount: number
  errorCount: number
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutEdge {
  source: string
  target: string
  callCount: number
  errorCount: number
  p50Ms: number
  p99Ms: number
  /** SVG path data for a cubic bezier curve */
  path: string
  /** Midpoint for label placement */
  labelX: number
  labelY: number
}

export interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  viewWidth: number
  viewHeight: number
}

const NODE_W = 140
const NODE_H = 52
const LAYER_GAP_X = 220 // horizontal gap between layer centres
const NODE_GAP_Y = 80 // vertical gap between nodes in a layer

export function layoutGraph(
  nodes: ServiceMapNode[],
  edges: ServiceMapEdge[],
): GraphLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], viewWidth: 0, viewHeight: 0 }
  }

  // ── 1. Build adjacency maps ───────────────────────────────────────────────
  const names = nodes.map((n) => n.serviceName)
  const outEdges = new Map<string, string[]>() // source → [targets]
  const inEdges = new Map<string, string[]>() // target → [sources]
  for (const n of names) {
    outEdges.set(n, [])
    inEdges.set(n, [])
  }
  for (const e of edges) {
    if (outEdges.has(e.source)) outEdges.get(e.source)!.push(e.target)
    if (inEdges.has(e.target)) inEdges.get(e.target)!.push(e.source)
  }

  // ── 2. Assign layers via BFS from roots (topological order) ──────────────
  const layer = new Map<string, number>()
  // Roots are nodes with no incoming edges
  const roots = names.filter((n) => (inEdges.get(n)?.length ?? 0) === 0)
  // If no roots (e.g. a cycle), fall back to all nodes
  const starts = roots.length > 0 ? roots : names
  const queue: string[] = [...starts]
  for (const r of starts) layer.set(r, 0)
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curLayer = layer.get(cur) ?? 0
    for (const next of outEdges.get(cur) ?? []) {
      const existing = layer.get(next) ?? -1
      if (existing <= curLayer) {
        layer.set(next, curLayer + 1)
        queue.push(next)
      }
    }
  }
  // Any node not yet assigned gets layer 0
  for (const n of names) {
    if (!layer.has(n)) layer.set(n, 0)
  }

  // ── 3. Group by layer ─────────────────────────────────────────────────────
  const maxLayer = Math.max(...Array.from(layer.values()))
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of names) layers[layer.get(n)!].push(n)

  // ── 4. Barycenter ordering within each layer ──────────────────────────────
  // Position within a layer = index in layers[l]
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      const prev = layers[l - 1]
      const posMap = new Map<string, number>()
      prev.forEach((n, i) => posMap.set(n, i))
      layers[l].sort((a, b) => {
        const aSources = inEdges.get(a) ?? []
        const bSources = inEdges.get(b) ?? []
        const aAvg =
          aSources.length > 0
            ? aSources.reduce((s, p) => s + (posMap.get(p) ?? 0), 0) /
              aSources.length
            : 999
        const bAvg =
          bSources.length > 0
            ? bSources.reduce((s, p) => s + (posMap.get(p) ?? 0), 0) /
              bSources.length
            : 999
        return aAvg - bAvg
      })
    }
  }

  // ── 5. Assign coordinates ─────────────────────────────────────────────────
  const maxNodesInLayer = Math.max(...layers.map((l) => l.length))
  const totalHeight = Math.max(
    maxNodesInLayer * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y,
    NODE_H,
  )

  const posMap = new Map<string, { x: number; y: number }>()
  for (let l = 0; l <= maxLayer; l++) {
    const nodesInLayer = layers[l]
    const layerHeight = nodesInLayer.length * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y
    const startY = (totalHeight - layerHeight) / 2
    const cx = l * LAYER_GAP_X + NODE_W / 2 // centre-x of layer
    nodesInLayer.forEach((n, i) => {
      posMap.set(n, {
        x: cx - NODE_W / 2,
        y: startY + i * (NODE_H + NODE_GAP_Y),
      })
    })
  }

  // ── 6. Build LayoutNodes ──────────────────────────────────────────────────
  const nodeMap = new Map<string, ServiceMapNode>()
  for (const n of nodes) nodeMap.set(n.serviceName, n)

  const layoutNodes: LayoutNode[] = names.map((n) => {
    const pos = posMap.get(n)!
    const src = nodeMap.get(n)!
    return {
      serviceName: n,
      nodeType: src.nodeType,
      system: src.system,
      spanCount: src.spanCount,
      errorCount: src.errorCount,
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: NODE_H,
    }
  })

  // ── 7. Build LayoutEdges (cubic bezier paths) ─────────────────────────────
  const layoutEdges: LayoutEdge[] = edges
    .filter((e) => posMap.has(e.source) && posMap.has(e.target))
    .map((e) => {
      const src = posMap.get(e.source)!
      const tgt = posMap.get(e.target)!

      // Connect right-centre of source to left-centre of target
      const x1 = src.x + NODE_W
      const y1 = src.y + NODE_H / 2
      const x2 = tgt.x
      const y2 = tgt.y + NODE_H / 2

      // Control points for bezier
      const dx = Math.abs(x2 - x1) * 0.5
      const path = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
      const labelX = (x1 + x2) / 2
      const labelY = (y1 + y2) / 2 - 8

      return {
        source: e.source,
        target: e.target,
        callCount: e.callCount,
        errorCount: e.errorCount,
        p50Ms: e.p50Ms,
        p99Ms: e.p99Ms,
        path,
        labelX,
        labelY,
      }
    })

  const viewWidth = maxLayer * LAYER_GAP_X + NODE_W
  const viewHeight = totalHeight

  return { nodes: layoutNodes, edges: layoutEdges, viewWidth, viewHeight }
}

// ─── Sticky (expand-only) layout ───────────────────────────────────────────────
// Unlike layoutGraph (a pure recompute that recentres the whole graph on every
// change — causing the visible reflow/"flash"), this keeps a persistent
// placement per node. Once a node is placed it NEVER moves: new nodes are
// appended to the bottom of their layer and the canvas simply grows. Counts and
// edge paths update in place. Nodes/edges are never removed (never age out).

interface Placement {
  layer: number
  slot: number
}

export interface StickyLayout {
  /** Merge a snapshot into the persistent layout and return positioned nodes/edges. */
  update(nodes: ServiceMapNode[], edges: ServiceMapEdge[]): GraphLayout
  /** Forget all placements (e.g. after an explicit clear / re-tidy). */
  reset(): void
}

function buildEdgePath(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
) {
  // Connect right-centre of source to left-centre of target (matches layoutGraph).
  const x1 = src.x + NODE_W
  const y1 = src.y + NODE_H / 2
  const x2 = tgt.x
  const y2 = tgt.y + NODE_H / 2
  const dx = Math.abs(x2 - x1) * 0.5
  const path = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
  return { path, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - 8 }
}

export function createStickyLayout(): StickyLayout {
  // Persistent across snapshots (and component remounts when held at module/
  // page scope): the source of position stability.
  const placements = new Map<string, Placement>()
  const nextSlot = new Map<number, number>() // layer -> next free slot index

  function coordsFor(p: Placement) {
    return {
      x: p.layer * LAYER_GAP_X,
      y: p.slot * (NODE_H + NODE_GAP_Y),
    }
  }

  function reset() {
    placements.clear()
    nextSlot.clear()
  }

  function update(
    nodes: ServiceMapNode[],
    edges: ServiceMapEdge[],
  ): GraphLayout {
    const names = nodes.map((n) => n.serviceName)
    const present = new Set(names)

    // Incoming sources per node (only count edges whose endpoints are present),
    // used to assign a layer to nodes not yet placed.
    const inEdges = new Map<string, string[]>()
    for (const n of names) inEdges.set(n, [])
    for (const e of edges) {
      if (present.has(e.source) && present.has(e.target)) {
        inEdges.get(e.target)!.push(e.source)
      }
    }

    // Known layers = already-placed nodes (fixed) + iterative resolution for the
    // unplaced ones (longest-path depth over currently-known neighbours).
    const knownLayer = new Map<string, number>()
    for (const [name, p] of placements) knownLayer.set(name, p.layer)
    const unplaced = names.filter((n) => !placements.has(n))

    let changed = true
    let guard = 0
    while (changed && guard++ <= unplaced.length + 2) {
      changed = false
      for (const n of unplaced) {
        const sources = inEdges.get(n) ?? []
        let layer = 0
        for (const s of sources) {
          const sl = knownLayer.get(s)
          if (sl !== undefined && sl + 1 > layer) layer = sl + 1
        }
        const prev = knownLayer.get(n)
        if (prev === undefined || layer > prev) {
          knownLayer.set(n, layer)
          changed = true
        }
      }
    }

    // Assign a slot to each newly-seen node, in array (first-appearance) order,
    // appending to the bottom of its layer. Existing nodes are untouched.
    for (const n of names) {
      if (placements.has(n)) continue
      const layer = knownLayer.get(n) ?? 0
      const slot = nextSlot.get(layer) ?? 0
      placements.set(n, { layer, slot })
      nextSlot.set(layer, slot + 1)
    }

    // Build positioned nodes from current stats + sticky placements.
    const nodeData = new Map<string, ServiceMapNode>()
    for (const n of nodes) nodeData.set(n.serviceName, n)

    const pos = new Map<string, { x: number; y: number }>()
    const layoutNodes: LayoutNode[] = []
    let maxLayer = 0
    let maxSlotCount = 0
    for (const [name, p] of placements) {
      const src = nodeData.get(name)
      if (!src) continue // node not in this snapshot (shouldn't happen — cumulative)
      const c = coordsFor(p)
      pos.set(name, c)
      if (p.layer > maxLayer) maxLayer = p.layer
      if (p.slot + 1 > maxSlotCount) maxSlotCount = p.slot + 1
      layoutNodes.push({
        serviceName: name,
        nodeType: src.nodeType,
        system: src.system,
        spanCount: src.spanCount,
        errorCount: src.errorCount,
        x: c.x,
        y: c.y,
        width: NODE_W,
        height: NODE_H,
      })
    }

    const layoutEdges: LayoutEdge[] = edges
      .filter((e) => pos.has(e.source) && pos.has(e.target))
      .map((e) => {
        const { path, labelX, labelY } = buildEdgePath(
          pos.get(e.source)!,
          pos.get(e.target)!,
        )
        return {
          source: e.source,
          target: e.target,
          callCount: e.callCount,
          errorCount: e.errorCount,
          p50Ms: e.p50Ms,
          p99Ms: e.p99Ms,
          path,
          labelX,
          labelY,
        }
      })

    const viewWidth = layoutNodes.length > 0 ? maxLayer * LAYER_GAP_X + NODE_W : 0
    const viewHeight =
      maxSlotCount > 0 ? maxSlotCount * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y : 0

    return { nodes: layoutNodes, edges: layoutEdges, viewWidth, viewHeight }
  }

  return { update, reset }
}
