// Test script to send protobuf OTLP trace data
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function sendProtobufTrace() {
	// Load proto files with proper include path
	const protoRoot = join(__dirname, 'proto');
	const root = new protobuf.Root();
	root.resolvePath = (origin, target) => {
		// Always resolve imports relative to protoRoot, ignoring origin
		// This is because all OTLP protos use absolute-style imports
		if (target.startsWith('opentelemetry/')) {
			return join(protoRoot, target);
		}
		return target;
	};
	
	await root.load('opentelemetry/proto/collector/trace/v1/trace_service.proto');
	const ExportTraceServiceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

	// Create a sample trace payload
	const payload = {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{
							key: 'service.name',
							value: {
								stringValue: 'protobuf-test-service'
							}
						}
					]
				},
				scopeSpans: [
					{
						scope: {
							name: 'test-scope',
							version: '1.0.0'
						},
						spans: [
							{
								traceId: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
								spanId: Buffer.from('0123456789abcdef', 'hex'),
								name: 'protobuf-test-span',
								kind: 1, // SPAN_KIND_INTERNAL
								startTimeUnixNano: 1704067200000000000, // 2024-01-01T00:00:00Z
								endTimeUnixNano: 1704067200123000000,   // +123ms
								attributes: [
									{
										key: 'http.method',
										value: {
											stringValue: 'GET'
										}
									},
									{
										key: 'http.status_code',
										value: {
											intValue: 200
										}
									}
								],
								status: {
									code: 1 // STATUS_CODE_OK
								}
							}
						]
					}
				]
			}
		]
	};

	// Encode to protobuf
	const errMsg = ExportTraceServiceRequest.verify(payload);
	if (errMsg) {
		throw new Error(`Invalid payload: ${errMsg}`);
	}

	const message = ExportTraceServiceRequest.create(payload);
	const buffer = ExportTraceServiceRequest.encode(message).finish();

	console.log('Encoded protobuf payload:', buffer.length, 'bytes');

	// Send to endpoint
	try {
		const response = await fetch('http://localhost:4318/v1/traces', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-protobuf'
			},
			body: buffer
		});

		const responseText = await response.text();
		console.log('Response status:', response.status);
		console.log('Response body:', responseText);

		if (response.ok) {
			console.log('✅ Protobuf trace sent successfully!');
		} else {
			console.error('❌ Failed to send protobuf trace');
		}
	} catch (error) {
		console.error('❌ Error sending trace:', error);
	}
}

// Run the test
sendProtobufTrace().catch(console.error);
