import type { SpanTreeNode } from '$lib/types'
import type { TraceLogListItem } from '$lib/types'
import { spanKindLabel } from '$lib/utils/spans'

/**
 * Returns the set of span IDs in `spanTree` that match `query`.
 * Searches: span id, name, service name, span kind, attributes, events, resource, scope.
 *
 * Returns an empty Set when `query` is blank.
 */
export function findMatchingSpanIds(
  spanTree: SpanTreeNode[],
  query: string,
  traceLogs: TraceLogListItem[] = [],
): Set<string> {
  const q = query.trim().toLowerCase()
  if (!q) return new Set<string>()

  const matches = new Set<string>()
  const spanIdsInTree = new Set<string>()

  function valueContainsQuery(value: unknown): boolean {
    if (value == null) return false
    if (typeof value === 'string') return value.toLowerCase().includes(q)
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(q)
    }

    try {
      const serialized = JSON.stringify(value)
      return (
        typeof serialized === 'string' && serialized.toLowerCase().includes(q)
      )
    } catch {
      return false
    }
  }

  function visit(nodes: SpanTreeNode[]) {
    for (const node of nodes) {
      const span = node.span
      spanIdsInTree.add(span.spanId)
      const serviceName = (span.resource['service.name'] as string) || 'unknown'
      let didMatch = false

      // Span ID
      if (span.spanId.toLowerCase().includes(q)) {
        didMatch = true
      }

      // Span name
      if (!didMatch && span.name.toLowerCase().includes(q)) {
        didMatch = true
      }

      // Service name
      if (!didMatch && serviceName.toLowerCase().includes(q)) {
        didMatch = true
      }

      // Span kind label
      if (!didMatch && spanKindLabel(span.kind).toLowerCase().includes(q)) {
        didMatch = true
      }

      // Attribute keys / values
      if (!didMatch) {
        for (const [key, value] of Object.entries(span.attributes)) {
          if (key.toLowerCase().includes(q) || valueContainsQuery(value)) {
            didMatch = true
            break
          }
        }
      }

      // Events: name and attributes
      if (!didMatch) {
        for (const event of span.events) {
          if (event.name.toLowerCase().includes(q)) {
            didMatch = true
            break
          }

          for (const [key, value] of Object.entries(event.attributes)) {
            if (key.toLowerCase().includes(q) || valueContainsQuery(value)) {
              didMatch = true
              break
            }
          }

          if (didMatch) break
        }
      }

      // Resource attributes
      if (!didMatch) {
        for (const [key, value] of Object.entries(span.resource)) {
          if (key.toLowerCase().includes(q) || valueContainsQuery(value)) {
            didMatch = true
            break
          }
        }
      }

      // Scope name, version, and attributes
      if (
        !didMatch &&
        (span.scopeName.toLowerCase().includes(q) ||
          span.scopeVersion.toLowerCase().includes(q))
      ) {
        didMatch = true
      }

      if (!didMatch) {
        for (const [key, value] of Object.entries(span.scopeAttributes)) {
          if (key.toLowerCase().includes(q) || valueContainsQuery(value)) {
            didMatch = true
            break
          }
        }
      }

      if (didMatch) {
        matches.add(span.spanId)
      }

      visit(node.children)
    }
  }

  visit(spanTree)

  for (const log of traceLogs) {
    if (!log.spanId || !spanIdsInTree.has(log.spanId)) {
      continue
    }

    const severity = (log.severityText || '').toLowerCase()
    const body = valueContainsQuery(log.body)
    const spanIdMatches = log.spanId.toLowerCase().includes(q)
    const logIdMatches = log.id.toLowerCase().includes(q)

    if (severity.includes(q) || body || spanIdMatches || logIdMatches) {
      matches.add(log.spanId)
    }
  }

  return matches
}
