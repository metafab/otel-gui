# Sample Traces & Demo Guide

This directory contains sample OTLP trace data to help you explore the features of otel-gui.

## Quick Start

### Run the E-commerce Demo

The easiest way to see all features is to run the automated demo:

```bash
./demo-ecommerce-trace.sh
```

This sends a realistic multi-service trace in two parts (simulating incremental span arrival) and shows you what to explore in the UI.

## Sample Traces Overview

### Basic Examples

#### `sample-trace.json`

Simple trace with a single frontend service showing basic span hierarchy.

- 1 service (frontend)
- 3 spans with parent-child relationships
- Database query and cache lookup

**Usage:**

```bash
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @samples/sample-trace.json

# Correlated logs for sample-trace.json
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d @samples/sample-log.json
```

### Advanced Examples

#### `sample-trace-ecommerce-part1.json` & `sample-trace-ecommerce-part2.json`

**Realistic distributed system scenario** demonstrating:

- ✅ **4 services**: frontend, backend-api, auth-service, database
- ✅ **Incremental ingestion**: Part 2 arrives after Part 1 (realistic behavior)
- ✅ **11 total spans** with hierarchical relationships
- ✅ **Error handling**: Database deadlock with automatic retry
- ✅ **Deep nesting**: Up to 4 levels for collapse/expand demo
- ✅ **Events**: Payment lifecycle, database locks, email queueing

**Trace ID:** `7c9e4f8a3b2d1e6f5a4c3b2a1d0e9f8c`

**Span Hierarchy:**

```
POST /checkout (frontend) - 1.25s total
├── validate cart (frontend) - 80ms
└── process payment (backend-api) - 900ms
    ├── validate payment details (backend-api) - 70ms
    ├── check inventory (backend-api) - 130ms
    ├── verify user session (auth-service) - 150ms
    │   └── query user permissions (auth-service) - 70ms
    ├── create order record (database) - 150ms
    ├── update inventory (database) ⚠️ ERROR - 150ms
    │   └── retry inventory update (database) ✓ - 120ms
    └── send confirmation email (backend-api) - 30ms
```

**Manual Usage:**

```bash
# Send part 1 (initial spans from frontend and backend-api)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @samples/sample-trace-ecommerce-part1.json

# Send part 1 correlated logs
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d @samples/sample-log-ecommerce-part1.json

# Wait a few seconds, then send part 2 (auth-service and database spans)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @samples/sample-trace-ecommerce-part2.json

# Send part 2 correlated logs
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d @samples/sample-log-ecommerce-part2.json
```

#### `sample-log.json`

Standalone OTLP logs example correlated with `sample-trace.json`:

- 3 log records
- INFO and WARN severities
- Linked to trace + span IDs for jump actions in the sidebar

**Usage:**

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d @samples/sample-log.json
```

## Features to Explore

Once traces are loaded, visit http://localhost:5173 to explore:

### 1. Multi-Service Visualization

- Each service is color-coded
- Service badges show which service owns each span
- Waterfall view shows timing across all services

### 2. Error Navigation

- Red "Spans with errors" badge appears when errors exist
- Use ↑↓ buttons to navigate between error spans
- Position indicator shows current error (e.g., "1/2")
- Click on error spans to see error details and stack traces

### 3. Span Hierarchy & Collapse/Expand

- **Click the ▼/▶ triangle** to collapse/expand spans with children
- **Keyboard navigation:**
  - `↑↓` - Navigate up/down through visible spans
  - `←` - Collapse current span (if it has children)
  - `→` - Expand current span (if collapsed)
  - `Enter` - Toggle collapse/expand

### 4. Search & Filtering

- **Search spans** by name, service, attributes, or events
- Navigate search results with ↑↓ buttons
- Match counter shows how many spans match

### 5. Span Details

- Click any span to see full details in the sidebar
- Attributes, events, status, and timing information
- Filter attributes by typing in the search box
- Click event diamonds on the timeline to jump to events

### 6. Correlated Logs in Sidebar

- Open any span in trace detail
- In **Correlated Logs**:
  - Filter by severity (Error/Warn/Info/etc.)
  - Filter by text (severity/body/spanId)
  - Toggle **Current span only**
- Use **Jump to log** and **Jump to span** to navigate context quickly

### 7. View Controls

- **Hide/Show Trace Details** - Focus on the waterfall view
- **Hide/Show Span Details** - Maximize waterfall space
- Toggle panels independently based on your workflow

### 8. Events on Timeline

- Orange diamonds (◆) mark events on the timeline
- Position shows when events occurred within the span
- Click diamonds to view event details in sidebar
- Hover for event name tooltip

## Creating Your Own Traces

### Real Application Integration

Configure your application to send traces to `http://localhost:4318/v1/traces`:

**OpenTelemetry SDK Example (Node.js):**

```javascript
const { Resource } = require('@opentelemetry/resources')
const {
  SemanticResourceAttributes,
} = require('@opentelemetry/semantic-conventions')
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node')
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base')

const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'my-service',
  }),
})

const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
})

provider.addSpanProcessor(new BatchSpanProcessor(exporter))
provider.register()
```

### Custom JSON Format

Follow the OTLP JSON format shown in the sample files:

**Required Fields:**

- `traceId` - Unique trace identifier (32 hex chars)
- `spanId` - Unique span identifier (16 hex chars)
- `parentSpanId` - Parent span ID (empty string for root spans)
- `name` - Span operation name
- `kind` - Span kind: 1=INTERNAL, 2=SERVER, 3=CLIENT, 4=PRODUCER, 5=CONSUMER
- `startTimeUnixNano` - Start time in nanoseconds as string
- `endTimeUnixNano` - End time in nanoseconds as string
- `status.code` - Status: 0=UNSET, 1=OK, 2=ERROR

**Best Practices:**

- Use consistent `traceId` across all spans in a trace
- Set `parentSpanId` to create hierarchy
- Include `service.name` in resource attributes
- Add meaningful attributes for debugging
- Set `status.code` to 2 and include error message for failures

## Trace Lifecycle

The viewer handles incremental span arrival automatically:

1. **First POST** - Creates trace with initial spans
2. **Subsequent POSTs** - Merges new spans into existing trace
3. **Out-of-order arrival** - Correctly builds hierarchy regardless of arrival order
4. **Updates** - Trace metadata (duration, error status) updates as new spans arrive

**Example:** The e-commerce demo sends child spans (auth-service, database) after parent spans (backend-api), demonstrating realistic distributed system behavior where spans arrive at different times.

## Troubleshooting

**Traces not appearing?**

- Check that the server is running: `pnpm dev`
- Verify the endpoint: `http://localhost:4318/v1/traces`
- Check browser console for errors
- Ensure JSON is valid OTLP format

**Spans missing from trace?**

- Verify `traceId` matches across all spans
- Check that `parentSpanId` references exist
- Wait a moment - spans may still be arriving

**Can't find a trace?**

- Use the trace list search: `http://localhost:5173`
- Filter by service, status, or operation name
- Traces are stored in memory (max 1000)

## Next Steps

- Try creating your own trace scenarios
- Instrument a real application with OpenTelemetry
- Explore keyboard shortcuts for fast navigation
- Use search to find specific spans or attributes
- Practice using error navigation on the e-commerce example

Happy tracing! 🔍
