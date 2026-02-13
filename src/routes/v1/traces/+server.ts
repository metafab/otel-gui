// OTLP/HTTP receiver endpoint
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { traceStore } from '$lib/server/traceStore';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const contentType = request.headers.get('content-type') || '';
		const contentEncoding = request.headers.get('content-encoding') || '';

		// Check for unsupported protobuf format
		if (contentType.includes('application/x-protobuf')) {
			return json(
				{ error: 'Protobuf format not yet supported. Please use application/json.' },
				{ status: 400 }
			);
		}

		// Check for gzip compression
		if (contentEncoding.includes('gzip')) {
			return json(
				{ error: 'Gzip compression not yet supported.' },
				{ status: 400 }
			);
		}

		// Parse JSON body
		if (contentType.includes('application/json')) {
			const body = await request.json();

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
		}

		// Unsupported content type
		return json(
			{ error: 'Unsupported Content-Type. Expected application/json.' },
			{ status: 400 }
		);
	} catch (error) {
		console.error('Error processing OTLP request:', error);
		return json(
			{ error: 'Internal server error processing traces' },
			{ status: 500 }
		);
	}
};
