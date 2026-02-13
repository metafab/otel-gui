// Server-side in-memory trace store
import type { TraceStore, StoredTrace, StoredSpan, TraceListItem } from '$lib/types';
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

			// Process all spans
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
					scopeVersion
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
		rootSpanName: trace.rootSpanName || 'unknown',
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
	clear,
	subscribe
};
