// API endpoint to get trace list
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { traceStore } from '$lib/server/traceStore';

export const GET: RequestHandler = async ({ url }) => {
	const limitParam = url.searchParams.get('limit');
	const DEFAULT_LIMIT = 100;
	const MAX_LIMIT = 1000;

	let limit = DEFAULT_LIMIT;

	if (limitParam !== null) {
		const parsed = Number.parseInt(limitParam, 10);

		if (!Number.isNaN(parsed) && parsed > 0) {
			limit = Math.min(parsed, MAX_LIMIT);
		}
	}
	const traces = traceStore.getTraceList(limit);

	return json(traces);
};

export const DELETE: RequestHandler = async () => {
	traceStore.clear();
	return json({ success: true });
};
