import { json } from '@sveltejs/kit';
import { traceStore } from '$lib/server/traceStore';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const traceId = url.searchParams.get('traceId') ?? undefined;
	const data = traceStore.getServiceMap(traceId);
	return json(data);
};
