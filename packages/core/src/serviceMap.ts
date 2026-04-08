import type {
  StoredTrace,
  ServiceMapData,
  ServiceMapNode,
  ServiceMapEdge,
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
