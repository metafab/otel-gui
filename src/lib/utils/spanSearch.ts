import type { SpanTreeNode } from '$lib/types';
import { spanKindLabel } from '$lib/utils/spans';

/**
 * Returns the set of span IDs in `spanTree` that match `query`.
 * Searches: name, service name, span kind, attributes, events, resource, scope.
 *
 * Returns an empty Set when `query` is blank.
 */
export function findMatchingSpanIds(spanTree: SpanTreeNode[], query: string): Set<string> {
	const q = query.trim().toLowerCase();
	if (!q) return new Set<string>();

	const matches = new Set<string>();

	for (const node of spanTree) {
		const span = node.span;
		const serviceName = (span.resource['service.name'] as string) || 'unknown';

		// Span name
		if (span.name.toLowerCase().includes(q)) {
			matches.add(span.spanId);
			continue;
		}

		// Service name
		if (serviceName.toLowerCase().includes(q)) {
			matches.add(span.spanId);
			continue;
		}

		// Span kind label
		if (spanKindLabel(span.kind).toLowerCase().includes(q)) {
			matches.add(span.spanId);
			continue;
		}

		// Attribute keys / values
		for (const [key, value] of Object.entries(span.attributes)) {
			if (key.toLowerCase().includes(q) || JSON.stringify(value).toLowerCase().includes(q)) {
				matches.add(span.spanId);
				break;
			}
		}
		if (matches.has(span.spanId)) continue;

		// Events: name and attributes
		for (const event of span.events) {
			if (event.name.toLowerCase().includes(q)) {
				matches.add(span.spanId);
				break;
			}
			for (const [key, value] of Object.entries(event.attributes)) {
				if (key.toLowerCase().includes(q) || JSON.stringify(value).toLowerCase().includes(q)) {
					matches.add(span.spanId);
					break;
				}
			}
			if (matches.has(span.spanId)) break;
		}
		if (matches.has(span.spanId)) continue;

		// Resource attributes
		for (const [key, value] of Object.entries(span.resource)) {
			if (key.toLowerCase().includes(q) || JSON.stringify(value).toLowerCase().includes(q)) {
				matches.add(span.spanId);
				break;
			}
		}
		if (matches.has(span.spanId)) continue;

		// Scope name, version, and attributes
		if (span.scopeName.toLowerCase().includes(q) || span.scopeVersion.toLowerCase().includes(q)) {
			matches.add(span.spanId);
			continue;
		}
		for (const [key, value] of Object.entries(span.scopeAttributes)) {
			if (key.toLowerCase().includes(q) || JSON.stringify(value).toLowerCase().includes(q)) {
				matches.add(span.spanId);
				break;
			}
		}
	}

	return matches;
}
