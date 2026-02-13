import type { StoredSpan, SpanTreeNode } from '$lib/types';

// Map SpanKind integer to label
export function spanKindLabel(kind: number): string {
	switch (kind) {
		case 0:
			return 'UNSPECIFIED';
		case 1:
			return 'INTERNAL';
		case 2:
			return 'SERVER';
		case 3:
			return 'CLIENT';
		case 4:
			return 'PRODUCER';
		case 5:
			return 'CONSUMER';
		default:
			return 'UNKNOWN';
	}
}

// Map Status code to label
export function statusLabel(code: number): string {
	switch (code) {
		case 0:
			return 'UNSET';
		case 1:
			return 'OK';
		case 2:
			return 'ERROR';
		default:
			return 'UNKNOWN';
	}
}

// Build span tree from flat span array
export function buildSpanTree(spans: StoredSpan[]): SpanTreeNode[] {
	// Create a map of spanId -> span for quick lookup
	const spanMap = new Map<string, StoredSpan>();
	for (const span of spans) {
		spanMap.set(span.spanId, span);
	}

	// Build parent -> children map
	const childrenMap = new Map<string, StoredSpan[]>();
	const rootSpans: StoredSpan[] = [];

	for (const span of spans) {
		if (!span.parentSpanId || span.parentSpanId === '') {
			// Root span (no parent)
			rootSpans.push(span);
		} else if (spanMap.has(span.parentSpanId)) {
			// Child span with valid parent
			const children = childrenMap.get(span.parentSpanId) || [];
			children.push(span);
			childrenMap.set(span.parentSpanId, children);
		} else {
			// Orphan span (parent not in this batch) - treat as root
			rootSpans.push(span);
		}
	}

	// Recursively build tree nodes
	function buildNode(span: StoredSpan, depth: number, visited: Set<string> = new Set()): SpanTreeNode {
		// Cycle detection: if we've already visited this span in this recursion path, skip it
		if (visited.has(span.spanId)) {
			return {
				span,
				depth,
				children: [],
				collapsed: false
			};
		}

		// Mark this span as visited in the current path
		const currentVisited = new Set(visited);
		currentVisited.add(span.spanId);

		const children = childrenMap.get(span.spanId) || [];
		// Sort children by start time
		children.sort((a, b) => a.startTimeUnixNano.localeCompare(b.startTimeUnixNano));

		return {
			span,
			depth,
			children: children.map((child) => buildNode(child, depth + 1, currentVisited)),
			collapsed: false
		};
	}

	// Sort root spans by start time
	rootSpans.sort((a, b) => a.startTimeUnixNano.localeCompare(b.startTimeUnixNano));

	return rootSpans.map((span) => buildNode(span, 0));
}

// Flatten tree to ordered list for rendering
export function flattenSpanTree(nodes: SpanTreeNode[]): SpanTreeNode[] {
	const result: SpanTreeNode[] = [];

	function traverse(node: SpanTreeNode) {
		result.push(node);
		if (!node.collapsed) {
			for (const child of node.children) {
				traverse(child);
			}
		}
	}

	for (const node of nodes) {
		traverse(node);
	}

	return result;
}

// Count total spans in subtree
export function countSubtreeSpans(node: SpanTreeNode): number {
	let count = 1; // count this node
	for (const child of node.children) {
		count += countSubtreeSpans(child);
	}
	return count;
}
