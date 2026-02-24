// OTLP/HTTP receiver endpoint
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { traceStore } from '$lib/server/traceStore';
import { decodeProtobuf } from '$lib/server/protobuf';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const contentType = request.headers.get('content-type') || '';
		const contentEncoding = request.headers.get('content-encoding') || '';

		// Check for gzip compression (not yet supported)
		if (contentEncoding.includes('gzip')) {
			return json(
				{ error: 'Gzip compression not yet supported.' },
				{ status: 400 }
			);
		}

		let body: { resourceSpans: any[] };

		// Handle Protobuf format
		if (contentType.includes('application/x-protobuf') || contentType.includes('application/protobuf')) {
			const arrayBuffer = await request.arrayBuffer();
			const buffer = new Uint8Array(arrayBuffer);
			body = await decodeProtobuf(buffer);
		}
		// Handle JSON format
		else if (contentType.includes('application/json')) {
			body = await request.json();
		}
		// Unsupported content type
		else {
			return json(
				{ error: 'Unsupported Content-Type. Expected application/json or application/x-protobuf.' },
				{ status: 400 }
			);
		}

		// Validate basic structure
		if (!body.resourceSpans) {
			return json(
				{ error: 'Invalid OTLP payload: missing resourceSpans' },
				{ status: 400 }
			);
		}

		// Ingest spans
		traceStore.ingest(body.resourceSpans);

		// Return successful response (empty is valid)
		return json({}, { status: 200 });
	} catch (error) {
		console.error('Error processing OTLP request:', error);
		return json(
			{ error: 'Internal server error processing traces' },
			{ status: 500 }
		);
	}
};
