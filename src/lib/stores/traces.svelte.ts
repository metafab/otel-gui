// Client-side reactive store for traces using Svelte 5 runes
import type { TraceListItem, StoredTrace } from '$lib/types';

// Polling interval (ms)
const POLL_INTERVAL = 2000;

// State management
let traces = $state.raw<TraceListItem[]>([]);
let selectedId = $state<string | null>(null);
let isLoading = $state<boolean>(false);
let error = $state<string | null>(null);

// Derived state
const selected = $derived(traces.find((t) => t.traceId === selectedId) || null);

// Fetch trace list from API
async function fetchTraces() {
	try {
		const response = await fetch('/api/traces?limit=1000');
		if (!response.ok) {
			throw new Error(`Failed to fetch traces: ${response.statusText}`);
		}
		const data = await response.json();
		traces = data;
		error = null;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Unknown error fetching traces';
		console.error('Error fetching traces:', err);
	}
}

// Start polling - to be called from component's $effect
function startPolling() {
	$effect(() => {
		const interval = setInterval(() => {
			fetchTraces();
		}, POLL_INTERVAL);

		// Initial fetch
		fetchTraces();

		return () => clearInterval(interval);
	});
}

// Fetch single trace detail
async function fetchTrace(traceId: string): Promise<StoredTrace | null> {
	try {
		isLoading = true;
		error = null;
		const response = await fetch(`/api/traces/${traceId}`);
		if (!response.ok) {
			throw new Error(`Failed to fetch trace: ${response.statusText}`);
		}
		const data = await response.json();
		return data;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Unknown error fetching trace';
		console.error('Error fetching trace:', err);
		return null;
	} finally {
		isLoading = false;
	}
}

// Select a trace by ID
function selectTrace(traceId: string | null) {
	selectedId = traceId;
}

// Clear all traces
async function clearAllTraces() {
	try {
		isLoading = true;
		error = null;
		const response = await fetch('/api/traces', { method: 'DELETE' });
		if (!response.ok) {
			throw new Error(`Failed to clear traces: ${response.statusText}`);
		}
		traces = [];
		selectedId = null;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Unknown error clearing traces';
		console.error('Error clearing traces:', err);
	} finally {
		isLoading = false;
	}
}

// Export reactive getters and actions
export const traceStore = {
	get traces() {
		return traces;
	},
	get selected() {
		return selected;
	},
	get selectedId() {
		return selectedId;
	},
	get isLoading() {
		return isLoading;
	},
	get error() {
		return error;
	},
	fetchTrace,
	selectTrace,
	clearAllTraces,
	startPolling
};
