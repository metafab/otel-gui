// Server-side in-memory trace store
import type {
	TraceStore,
	StoredTrace,
	StoredSpan,
	TraceListItem,
	ServiceMapData,
	ServiceMapNode,
	ServiceMapEdge
} from '$lib/types';
import { flattenAttributes } from '$lib/utils/attributes';
import { formatTimestamp, getDurationMs } from '$lib/utils/time';

// In-memory storage (persists across requests with adapter-node)
const traces = new Map<string, StoredTrace>();
const listeners = new Set<() => void>();

const MAX_TRACES = 1000; // Maximum traces to keep in memory

function notifyListeners() {
	for (const listener of listeners) {
		listener();
	}
}

function ingest(resourceSpans: any[]): void {
	if (!resourceSpans || !Array.isArray(resourceSpans)) {
		return;
	}

	for (const rs of resourceSpans) {
		// Extract resource attributes (service.name, etc.)
		const resourceAttrs = flattenAttributes(rs.resource?.attributes);
		const serviceName = (resourceAttrs['service.name'] as string) || 'unknown';

		// Process all scope spans
		const scopeSpansList = rs.scopeSpans || [];
		for (const ss of scopeSpansList) {
			const scopeName = ss.scope?.name || '';
			const scopeVersion = ss.scope?.version || '';
			const scopeAttributes = flattenAttributes(ss.scope?.attributes);
			const spans = ss.spans || [];
			for (const span of spans) {
				const traceId = span.traceId;
				if (!traceId) continue;

				// Get or create trace
				let trace = traces.get(traceId);
				if (!trace) {
					trace = {
						traceId,
						rootSpanName: '',
						serviceName,
						startTimeUnixNano: span.startTimeUnixNano,
						endTimeUnixNano: span.endTimeUnixNano,
						spanCount: 0,
						hasError: false,
						spans: new Map()
					};
					traces.set(traceId, trace);

					// Evict oldest trace if we exceed max
					if (traces.size > MAX_TRACES) {
						const oldestTraceId = traces.keys().next().value;
						if (oldestTraceId) {
							traces.delete(oldestTraceId);
						}
					}
				}

				// Create stored span
				const storedSpan: StoredSpan = {
					traceId: span.traceId,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId || '',
					name: span.name || '',
					kind: span.kind || 0,
					startTimeUnixNano: span.startTimeUnixNano,
					endTimeUnixNano: span.endTimeUnixNano,
					attributes: flattenAttributes(span.attributes),
					events: (span.events || []).map((e: any) => ({
						timeUnixNano: e.timeUnixNano,
						name: e.name || '',
						attributes: flattenAttributes(e.attributes)
					})),
					links: (span.links || []).map((l: any) => ({
						traceId: l.traceId,
						spanId: l.spanId,
						traceState: l.traceState || '',
						attributes: flattenAttributes(l.attributes)
					})),
					status: {
						code: span.status?.code || 0,
						message: span.status?.message || ''
					},
					resource: resourceAttrs,
					scopeName,
					scopeVersion,
					scopeAttributes
				};

				// Add span to trace
				trace.spans.set(span.spanId, storedSpan);

				// Update trace metadata
				trace.spanCount = trace.spans.size;

				// Update root span name (span with no parent)
				if (!storedSpan.parentSpanId || storedSpan.parentSpanId === '') {
					trace.rootSpanName = storedSpan.name;
				}

				// Update trace time range
				if (span.startTimeUnixNano < trace.startTimeUnixNano) {
					trace.startTimeUnixNano = span.startTimeUnixNano;
				}
				if (span.endTimeUnixNano > trace.endTimeUnixNano) {
					trace.endTimeUnixNano = span.endTimeUnixNano;
				}

				// Check for errors
				if (storedSpan.status.code === 2) {
					trace.hasError = true;
				}

				// Use first seen service name if not set
				if (trace.serviceName === 'unknown' && serviceName !== 'unknown') {
					trace.serviceName = serviceName;
				}
			}
		}
	}

	notifyListeners();
}

// Find the effective root span name for a trace.
// Tries true root (no parentSpanId) first, then falls back to the earliest
// orphan — a span whose parent is not present in this trace (typical in
// multi-service traces where the gateway root arrives in a separate batch
// or was never instrumented).
export function resolveRootSpanName(trace: StoredTrace): string {
	const spans = Array.from(trace.spans.values());
	let rootSpan = spans.find((s) => !s.parentSpanId || s.parentSpanId === '');
	if (!rootSpan) {
		const orphans = spans.filter((s) => !trace.spans.has(s.parentSpanId));
		if (orphans.length > 0) {
			orphans.sort((a, b) =>
				BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1
			);
			rootSpan = orphans[0];
		}
	}
	return rootSpan?.name || 'unknown';
}

function getTraceList(limit = 100): TraceListItem[] {
	const traceArray = Array.from(traces.values());

	// Sort by start time descending (newest first)
	traceArray.sort((a, b) => {
		const aBigInt = BigInt(b.startTimeUnixNano);
		const bBigInt = BigInt(a.startTimeUnixNano);
		return aBigInt > bBigInt ? 1 : aBigInt < bBigInt ? -1 : 0;
	});

	return traceArray.slice(0, limit).map((trace) => ({
			traceId: trace.traceId,
			rootSpanName: resolveRootSpanName(trace),
			serviceName: trace.serviceName,
			durationMs: getDurationMs(trace.startTimeUnixNano, trace.endTimeUnixNano),
			spanCount: trace.spanCount,
			hasError: trace.hasError,
			startTime: formatTimestamp(trace.startTimeUnixNano)
		}));
}

function getTrace(traceId: string): StoredTrace | undefined {
	return traces.get(traceId);
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)] / 1_000_000; // ns → ms
}

function getServiceMap(filterTraceId?: string): ServiceMapData {
	const nodeMap = new Map<string, ServiceMapNode>();
	// edge key: `${source}||${target}`
	const edgeMap = new Map<string, { callCount: number; errorCount: number; durations: number[] }>();

	const tracesToProcess = filterTraceId
		? ([traces.get(filterTraceId)].filter(Boolean) as StoredTrace[])
		: Array.from(traces.values());

	for (const trace of tracesToProcess) {
		for (const span of trace.spans.values()) {
			const svc = (span.resource['service.name'] as string) || 'unknown';
			const isError = span.status.code === 2;

			// ── Node aggregation ──────────────────────────────────────────────
			if (!nodeMap.has(svc)) {
				nodeMap.set(svc, { serviceName: svc, spanCount: 0, errorCount: 0, nodeType: 'service' });
			}
			const node = nodeMap.get(svc)!;
			node.spanCount++;
			if (isError) node.errorCount++;

			// ── Edge detection ────────────────────────────────────────────────
			// Primary: cross-service parent→child relationship
			if (span.parentSpanId) {
				const parentSpan = trace.spans.get(span.parentSpanId);
				if (parentSpan) {
					const parentSvc = (parentSpan.resource['service.name'] as string) || 'unknown';
					if (parentSvc !== svc) {
						const key = `${parentSvc}||${svc}`;
						if (!edgeMap.has(key)) edgeMap.set(key, { callCount: 0, errorCount: 0, durations: [] });
						const edge = edgeMap.get(key)!;
						edge.callCount++;
						if (isError) edge.errorCount++;
						const durationNs =
							Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano));
						edge.durations.push(durationNs);
					}
				}
			}

			// Secondary: CLIENT spans pointing to an external system via span attributes
			if (span.kind === 3 /* CLIENT */) {
				const dbSystem = span.attributes['db.system'] as string | undefined;
				const dbName = span.attributes['db.name'] as string | undefined;
				const msgSystem = span.attributes['messaging.system'] as string | undefined;
				const rpcSystem = span.attributes['rpc.system'] as string | undefined;
				const peerService =
					(span.attributes['peer.service'] as string | undefined) ||
					(span.attributes['net.peer.name'] as string | undefined) ||
					(span.attributes['server.address'] as string | undefined);

				let externalName: string | undefined;
				let nodeType: ServiceMapNode['nodeType'] = 'service';
				let system: string | undefined;

				if (dbSystem) {
					externalName = dbName ? `${dbSystem}/${dbName}` : dbSystem;
					nodeType = 'database';
					system = dbSystem;
				} else if (msgSystem) {
					externalName = msgSystem;
					nodeType = 'messaging';
					system = msgSystem;
				} else if (rpcSystem && peerService) {
					externalName = peerService;
					nodeType = 'rpc';
					system = rpcSystem;
				} else if (peerService) {
					externalName = peerService;
				}

				// Only create synthetic edge if the external node isn't already a known service
				if (externalName && externalName !== svc && !nodeMap.has(externalName)) {
					nodeMap.set(externalName, {
						serviceName: externalName,
						spanCount: 0,
						errorCount: 0,
						nodeType,
						system
					});
				}
				if (externalName && externalName !== svc) {
					// Check if there's no parent-based edge already for this span
					const hasParentEdge =
						span.parentSpanId && trace.spans.has(span.parentSpanId)
							? (trace.spans.get(span.parentSpanId)!.resource['service.name'] as string) !== svc
							: false;
					if (!hasParentEdge) {
						const key = `${svc}||${externalName}`;
						if (!edgeMap.has(key)) edgeMap.set(key, { callCount: 0, errorCount: 0, durations: [] });
						const edge = edgeMap.get(key)!;
						edge.callCount++;
						if (isError) edge.errorCount++;
						const durationNs =
							Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano));
						edge.durations.push(durationNs);
					}
					// Update external node counts
					const extNode = nodeMap.get(externalName)!;
					extNode.spanCount++;
					if (isError) extNode.errorCount++;
				}
			}
		}
	}

	// Build final edge list with computed percentiles
	const edges: ServiceMapEdge[] = [];
	for (const [key, data] of edgeMap) {
		const [source, target] = key.split('||');
		const sorted = [...data.durations].sort((a, b) => a - b);
		edges.push({
			source,
			target,
			callCount: data.callCount,
			errorCount: data.errorCount,
			durations: sorted,
			p50Ms: percentile(sorted, 50),
			p99Ms: percentile(sorted, 99)
		});
	}

	return {
		nodes: Array.from(nodeMap.values()),
		edges
	};
}

function clear(): void {
	traces.clear();
	notifyListeners();
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

// Export the store instance
export const traceStore: TraceStore = {
	ingest,
	getTraceList,
	getTrace,
	getServiceMap,
	clear,
	subscribe
};
