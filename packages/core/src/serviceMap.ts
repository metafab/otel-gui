import type {
  StoredTrace,
  StoredSpan,
  ServiceMapData,
  ServiceMapNode,
  ServiceMapEdge,
  ServiceMapAggregate,
} from './types.js'
import { percentileNsToMs } from './stats.js'

/**
 * Computes the service map from a collection of traces.
 *
 * Algorithm:
 * 1. **Cross-service parent→child**: when a span's service.name differs from
 *    its parent span's service.name, emit an edge `parentService → childService`.
 * 2. **External systems**: CLIENT spans (kind === 3) that reference db, messaging,
 *    rpc, or peer attributes generate synthetic external nodes and edges.
 *
 * @param tracesToProcess - The traces to aggregate.
 */
export function buildServiceMap(
  tracesToProcess: StoredTrace[],
): ServiceMapData {
  const nodeMap = new Map<string, ServiceMapNode>()
  // edge key: `${source}||${target}`
  const edgeMap = new Map<
    string,
    { callCount: number; errorCount: number; durations: number[] }
  >()

  for (const trace of tracesToProcess) {
    for (const span of trace.spans.values()) {
      const svc = (span.resource['service.name'] as string) || 'unknown'
      const isError = span.status.code === 2

      // ── Node aggregation ─────────────────────────────────────────────
      if (!nodeMap.has(svc)) {
        nodeMap.set(svc, {
          serviceName: svc,
          spanCount: 0,
          errorCount: 0,
          nodeType: 'service',
        })
      }
      const node = nodeMap.get(svc)!
      node.spanCount++
      if (isError) node.errorCount++

      // ── Edge detection ────────────────────────────────────────────────
      // Primary: cross-service parent→child relationship
      if (span.parentSpanId) {
        const parentSpan = trace.spans.get(span.parentSpanId)
        if (parentSpan) {
          const parentSvc =
            (parentSpan.resource['service.name'] as string) || 'unknown'
          if (parentSvc !== svc) {
            const key = `${parentSvc}||${svc}`
            if (!edgeMap.has(key))
              edgeMap.set(key, { callCount: 0, errorCount: 0, durations: [] })
            const edge = edgeMap.get(key)!
            edge.callCount++
            if (isError) edge.errorCount++
            edge.durations.push(
              Number(
                BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
              ),
            )
          }
        }
      }

      // Secondary: CLIENT spans pointing to an external system via attributes
      if (span.kind === 3 /* CLIENT */) {
        const dbSystem = span.attributes['db.system'] as string | undefined
        const dbName = span.attributes['db.name'] as string | undefined
        const msgSystem = span.attributes['messaging.system'] as
          | string
          | undefined
        const rpcSystem = span.attributes['rpc.system'] as string | undefined
        const peerService =
          (span.attributes['peer.service'] as string | undefined) ||
          (span.attributes['net.peer.name'] as string | undefined) ||
          (span.attributes['server.address'] as string | undefined)

        let externalName: string | undefined
        let nodeType: ServiceMapNode['nodeType'] = 'service'
        let system: string | undefined

        if (dbSystem) {
          externalName = dbName ? `${dbSystem}/${dbName}` : dbSystem
          nodeType = 'database'
          system = dbSystem
        } else if (msgSystem) {
          externalName = msgSystem
          nodeType = 'messaging'
          system = msgSystem
        } else if (rpcSystem && peerService) {
          externalName = peerService
          nodeType = 'rpc'
          system = rpcSystem
        } else if (peerService) {
          externalName = peerService
        }

        if (externalName && externalName !== svc) {
          // Ensure external node exists (only if not already a known service)
          if (!nodeMap.has(externalName)) {
            nodeMap.set(externalName, {
              serviceName: externalName,
              spanCount: 0,
              errorCount: 0,
              nodeType,
              system,
            })
          }

          // Only add attribute-based edge when there's no parent-based edge
          const hasParentEdge =
            span.parentSpanId && trace.spans.has(span.parentSpanId)
              ? (trace.spans.get(span.parentSpanId)!.resource[
                  'service.name'
                ] as string) !== svc
              : false

          if (!hasParentEdge) {
            const key = `${svc}||${externalName}`
            if (!edgeMap.has(key))
              edgeMap.set(key, { callCount: 0, errorCount: 0, durations: [] })
            const edge = edgeMap.get(key)!
            edge.callCount++
            if (isError) edge.errorCount++
            edge.durations.push(
              Number(
                BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
              ),
            )
          }

          // Update external node counts
          const extNode = nodeMap.get(externalName)!
          extNode.spanCount++
          if (isError) extNode.errorCount++
        }
      }
    }
  }

  // Build final edge list with computed percentiles
  const edges: ServiceMapEdge[] = []
  for (const [key, data] of edgeMap) {
    const [source, target] = key.split('||')
    const sorted = [...data.durations].sort((a, b) => a - b)
    edges.push({
      source,
      target,
      callCount: data.callCount,
      errorCount: data.errorCount,
      durations: sorted,
      p50Ms: percentileNsToMs(sorted, 50),
      p99Ms: percentileNsToMs(sorted, 99),
    })
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  }
}

// ─── Cumulative aggregate (incremental, never-age-out) ─────────────────────────

// Cap on retained recent durations per edge. callCount/errorCount stay fully
// cumulative; only the latency sample window is bounded, so p50/p99 reflect
// recent behaviour without unbounded memory growth over a long session.
const MAX_EDGE_DURATIONS = 512

export function createServiceMapAggregate(): ServiceMapAggregate {
  return {
    nodes: new Map(),
    edges: new Map(),
    spanService: new Map(),
    countedNodeSpans: new Set(),
    resolvedEdgeSpans: new Set(),
    pendingChildren: new Map(),
  }
}

export function clearServiceMapAggregate(agg: ServiceMapAggregate): void {
  agg.nodes.clear()
  agg.edges.clear()
  agg.spanService.clear()
  agg.countedNodeSpans.clear()
  agg.resolvedEdgeSpans.clear()
  agg.pendingChildren.clear()
}

interface ExternalTarget {
  name: string
  nodeType: ServiceMapNode['nodeType']
  system?: string
}

// Mirror of buildServiceMap's secondary (CLIENT → external system) detection.
function resolveExternalTarget(
  attributes: Record<string, any>,
  svc: string,
): ExternalTarget | null {
  const dbSystem = attributes['db.system'] as string | undefined
  const dbName = attributes['db.name'] as string | undefined
  const msgSystem = attributes['messaging.system'] as string | undefined
  const rpcSystem = attributes['rpc.system'] as string | undefined
  const peerService =
    (attributes['peer.service'] as string | undefined) ||
    (attributes['net.peer.name'] as string | undefined) ||
    (attributes['server.address'] as string | undefined)

  let name: string | undefined
  let nodeType: ServiceMapNode['nodeType'] = 'service'
  let system: string | undefined

  if (dbSystem) {
    name = dbName ? `${dbSystem}/${dbName}` : dbSystem
    nodeType = 'database'
    system = dbSystem
  } else if (msgSystem) {
    name = msgSystem
    nodeType = 'messaging'
    system = msgSystem
  } else if (rpcSystem && peerService) {
    name = peerService
    nodeType = 'rpc'
    system = rpcSystem
  } else if (peerService) {
    name = peerService
  }

  if (!name || name === svc) return null
  return { name, nodeType, system }
}

function ensureNode(
  agg: ServiceMapAggregate,
  name: string,
  nodeType: ServiceMapNode['nodeType'],
  system?: string,
): ServiceMapNode {
  let node = agg.nodes.get(name)
  if (!node) {
    node = { serviceName: name, spanCount: 0, errorCount: 0, nodeType, system }
    agg.nodes.set(name, node)
  }
  return node
}

function addEdge(
  agg: ServiceMapAggregate,
  source: string,
  target: string,
  isError: boolean,
  durNs: number,
): void {
  const key = `${source}||${target}`
  let edge = agg.edges.get(key)
  if (!edge) {
    edge = { source, target, callCount: 0, errorCount: 0, durations: [] }
    agg.edges.set(key, edge)
  }
  edge.callCount++
  if (isError) edge.errorCount++
  edge.durations.push(durNs)
  if (edge.durations.length > MAX_EDGE_DURATIONS) edge.durations.shift()
}

// Emit a child span's single edge contribution once its parent service is known
// (or known to be absent). Cross-service parent → child edge takes precedence;
// otherwise fall back to the child's CLIENT-external attribute edge, matching
// buildServiceMap's precedence exactly.
function emitChildEdge(
  agg: ServiceMapAggregate,
  parentSvc: string | undefined,
  childSvc: string,
  isError: boolean,
  durNs: number,
  external: ExternalTarget | null,
): void {
  if (parentSvc !== undefined && parentSvc !== childSvc) {
    addEdge(agg, parentSvc, childSvc, isError, durNs)
    return
  }
  // No cross-service parent edge — use the attribute-based external edge, if any.
  if (external) {
    addEdge(agg, childSvc, external.name, isError, durNs)
  }
}

/**
 * Fold a single stored span into the cumulative aggregate.
 *
 * Idempotent per `${traceId}|${spanId}`: re-ingesting a span never double-counts.
 * Cross-service edges are resolved out-of-order — a child whose parent has not
 * arrived yet is held in `pendingChildren` and emitted when the parent (which
 * carries the parent service) is later folded in.
 */
export function accumulateSpan(
  agg: ServiceMapAggregate,
  span: StoredSpan,
): void {
  const svc = (span.resource['service.name'] as string) || 'unknown'
  const traceId = span.traceId
  const spanKey = `${traceId}|${span.spanId}`
  const isError = span.status.code === 2
  const external =
    span.kind === 3 /* CLIENT */
      ? resolveExternalTarget(span.attributes, svc)
      : null

  let durNs: number
  try {
    const d = BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)
    durNs = d > 0n ? Number(d) : 0
  } catch {
    durNs = 0
  }

  agg.spanService.set(spanKey, svc)

  // ── Node stats (once per span) ───────────────────────────────────────────
  if (!agg.countedNodeSpans.has(spanKey)) {
    agg.countedNodeSpans.add(spanKey)
    const node = ensureNode(agg, svc, 'service')
    node.spanCount++
    if (isError) node.errorCount++
    // External node stats accrue for every CLIENT-external span, independent of
    // whether an attribute edge is later drawn (mirrors buildServiceMap).
    if (external) {
      const extNode = ensureNode(agg, external.name, external.nodeType, external.system)
      extNode.spanCount++
      if (isError) extNode.errorCount++
    }
  }

  // ── Edge contribution of this span as a CHILD (once) ─────────────────────
  if (!agg.resolvedEdgeSpans.has(spanKey)) {
    if (!span.parentSpanId) {
      // Root span: no parent edge possible — attribute edge only.
      emitChildEdge(agg, undefined, svc, isError, durNs, external)
      agg.resolvedEdgeSpans.add(spanKey)
    } else {
      const parentKey = `${traceId}|${span.parentSpanId}`
      const parentSvc = agg.spanService.get(parentKey)
      if (parentSvc !== undefined) {
        emitChildEdge(agg, parentSvc, svc, isError, durNs, external)
        agg.resolvedEdgeSpans.add(spanKey)
      } else {
        // Parent not ingested yet — defer until it arrives. Mark resolved so a
        // re-ingest of this span before the parent shows up can't double-enqueue.
        const list = agg.pendingChildren.get(parentKey)
        const entry = {
          childKey: spanKey,
          childSvc: svc,
          isError,
          durNs,
          external,
        }
        if (list) list.push(entry)
        else agg.pendingChildren.set(parentKey, [entry])
        agg.resolvedEdgeSpans.add(spanKey)
      }
    }
  }

  // ── Resolve children that were waiting on THIS span as their parent ───────
  const waiting = agg.pendingChildren.get(spanKey)
  if (waiting) {
    agg.pendingChildren.delete(spanKey)
    for (const child of waiting) {
      emitChildEdge(agg, svc, child.childSvc, child.isError, child.durNs, child.external)
    }
  }
}

/** Project the cumulative aggregate into the wire shape (computes percentiles). */
export function projectServiceMap(agg: ServiceMapAggregate): ServiceMapData {
  const nodes: ServiceMapNode[] = Array.from(agg.nodes.values()).map((n) => ({
    ...n,
  }))

  const edges: ServiceMapEdge[] = []
  for (const e of agg.edges.values()) {
    const sorted = [...e.durations].sort((a, b) => a - b)
    edges.push({
      source: e.source,
      target: e.target,
      callCount: e.callCount,
      errorCount: e.errorCount,
      durations: sorted,
      p50Ms: percentileNsToMs(sorted, 50),
      p99Ms: percentileNsToMs(sorted, 99),
    })
  }

  return { nodes, edges }
}
