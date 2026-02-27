# Research: Lightweight Local OpenTelemetry Trace Viewer

## 1. OTLP/HTTP Protocol

### Endpoints

| Signal  | Path          | Method | Request Body                  |
| ------- | ------------- | ------ | ----------------------------- |
| Traces  | `/v1/traces`  | POST   | `ExportTraceServiceRequest`   |
| Metrics | `/v1/metrics` | POST   | `ExportMetricsServiceRequest` |
| Logs    | `/v1/logs`    | POST   | `ExportLogsServiceRequest`    |

- Default port: **4318** (HTTP), 4317 (gRPC)
- Content types: `application/json` (JSON protobuf) and `application/x-protobuf` (binary protobuf)
- Compression: gzip supported via `Content-Encoding: gzip`
- The receiver should accept both formats on the same port, dispatching based on `Content-Type` header

### JSON Encoding Deviations from Standard Proto3

These are critical — OTLP JSON is **not** standard proto3 JSON:

1. **`traceId` and `spanId`** are lowercase **hex-encoded strings** (NOT base64). TraceId = 32-hex-char string, SpanId = 16-hex-char string.
2. **Enum fields** use **integer values** (not string names). e.g., `SpanKind` = `2` not `"SPAN_KIND_SERVER"`.
3. **Key names** are **lowerCamelCase** (e.g., `traceId`, `spanId`, `startTimeUnixNano`, `parentSpanId`).
4. **Integer values** (`fixed64` for timestamps) are encoded as **strings** in JSON (e.g., `"1544712660000000000"`).

### Response Format

- **Success**: HTTP 200 with `ExportTraceServiceResponse` body (same content-type as request)
- **Partial success**: HTTP 200 with `partial_success` populated (`rejected_spans` count + `error_message`)
- **Client errors**: HTTP 400 (bad data, not retryable)
- **Retryable errors**: HTTP 429, 502, 503, 504
- **Throttling**: 429 or 503 with optional `Retry-After` header

For a fully accepted request, the response body can be empty `{}` (JSON) or empty `ExportTraceServiceResponse` (protobuf). HTTP 200 is sufficient.

---

## 2. OTLP Data Model

### Message Hierarchy

```
ExportTraceServiceRequest
└── repeated ResourceSpans resource_spans
    ├── Resource resource
    │   ├── repeated KeyValue attributes  (e.g., service.name, service.version)
    │   └── uint32 dropped_attributes_count
    ├── string schema_url
    └── repeated ScopeSpans scope_spans
        ├── InstrumentationScope scope
        │   ├── string name
        │   ├── string version
        │   ├── repeated KeyValue attributes
        │   └── uint32 dropped_attributes_count
        ├── string schema_url
        └── repeated Span spans
```

### Span Fields

| Field                  | Type              | Description                                                           |
| ---------------------- | ----------------- | --------------------------------------------------------------------- |
| `trace_id`             | bytes (16 bytes)  | Unique trace identifier. Hex-encoded in JSON (32 chars).              |
| `span_id`              | bytes (8 bytes)   | Unique span identifier. Hex-encoded in JSON (16 chars).               |
| `parent_span_id`       | bytes (8 bytes)   | Parent span's ID. Empty = root span.                                  |
| `trace_state`          | string            | W3C TraceContext tracestate header value.                             |
| `name`                 | string            | Operation name (e.g., `GET /api/users`).                              |
| `kind`                 | SpanKind (int)    | 0=UNSPECIFIED, 1=INTERNAL, 2=SERVER, 3=CLIENT, 4=PRODUCER, 5=CONSUMER |
| `start_time_unix_nano` | fixed64           | Start timestamp in nanoseconds since epoch.                           |
| `end_time_unix_nano`   | fixed64           | End timestamp in nanoseconds since epoch.                             |
| `attributes`           | repeated KeyValue | Key-value pairs.                                                      |
| `events`               | repeated Event    | Timestamped annotations.                                              |
| `links`                | repeated Link     | References to other spans/traces.                                     |
| `status`               | Status            | `code` (0=UNSET, 1=OK, 2=ERROR) + `message` string.                   |
| `flags`                | fixed32           | Bit field: bits 0-7 = W3C trace flags, bits 8-9 = is_remote.          |
| `dropped_*_count`      | uint32            | Counts of dropped attributes/events/links.                            |

### Event (sub-message of Span)

| Field                      | Type              | Description              |
| -------------------------- | ----------------- | ------------------------ |
| `time_unix_nano`           | fixed64           | When the event occurred. |
| `name`                     | string            | Event name.              |
| `attributes`               | repeated KeyValue | Event attributes.        |
| `dropped_attributes_count` | uint32            |                          |

### Link (sub-message of Span)

| Field         | Type              | Description             |
| ------------- | ----------------- | ----------------------- |
| `trace_id`    | bytes             | TraceId of linked span. |
| `span_id`     | bytes             | SpanId of linked span.  |
| `trace_state` | string            |                         |
| `attributes`  | repeated KeyValue |                         |
| `flags`       | fixed32           |                         |

### KeyValue / AnyValue

```
KeyValue { string key; AnyValue value; }

AnyValue (oneof):
  string_value  → "stringValue" in JSON
  bool_value    → "boolValue"
  int_value     → "intValue" (int64, encoded as string in JSON)
  double_value  → "doubleValue"
  array_value   → "arrayValue" { values: [AnyValue...] }
  kvlist_value  → "kvlistValue" { values: [KeyValue...] }
  bytes_value   → "bytesValue" (base64-encoded in JSON)
```

### How Traces Are Reconstructed

A **trace** is not an explicit object — it's the collection of all spans sharing the same `traceId`. The tree structure is built by matching `parent_span_id` to `span_id`. The root span has an empty `parent_span_id`. Multiple `ExportTraceServiceRequest` messages may carry spans from the same trace (spans arrive incrementally).

### JSON Example

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "my.service" } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "my.library", "version": "1.0.0" },
          "spans": [
            {
              "traceId": "5B8EFFF798038103D269B633813FC60C",
              "spanId": "EEE19B7EC3C1B174",
              "parentSpanId": "EEE19B7EC3C1B173",
              "name": "I'm a server span",
              "startTimeUnixNano": "1544712660000000000",
              "endTimeUnixNano": "1544712661000000000",
              "kind": 2,
              "attributes": [
                {
                  "key": "my.span.attr",
                  "value": { "stringValue": "some value" }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 3. Honeycomb UI Reference

### Trace Detail View — Four Sections

Honeycomb's trace detail view (see [Interact with Traces](https://docs.honeycomb.io/investigate/analyze/explore-traces/#interact-with-traces)) is organized into four areas:

#### Section 1: Trace Identification (top bar)

- Trace ID displayed prominently
- Back arrow to return to the query/list
- "Reload Trace" button to re-fetch late-arriving spans
- Warning banner if missing spans detected

#### Section 2: Trace Summary (collapsible minimap)

- Condensed horizontal bar chart showing span depth levels (up to 6 rows)
- Each row = one tree depth level. First row = root span, second row = root's children, etc.
- Bar widths proportional to span duration relative to total trace duration
- Metadata: total span count, root span timestamp, total trace duration
- Hover over a bar → tooltip with longest-running span name at that depth/time
- Click a bar → jumps to that span in the waterfall below
- "Highlight errors" toggle: error spans appear in red
- Collapsible via directional caret

#### Section 3: Waterfall Representation (main area)

- Reconstructed parent-child relationships displayed as a waterfall/gantt diagram
- Each row shows: child-count box, span name, duration bar
- Child-count box: shows number of dependent spans; click to collapse/expand subtree
  - Collapsed: filled box, number = total subtree size
  - Expanded: outlined box, number = direct children
- Selected span row highlighted in blue
- **Search spans**: search box filters/highlights matching spans, shows count + prev/next navigation arrows
- **Error highlighting**: error span count displayed above waterfall, error spans rendered in red
- **Color by service.name** by default (distinct color per service); can change color-by field via column header
- **Customizable columns**: "Fields" button lets you add attribute columns to the waterfall
- **Resizable columns**: drag borders between column headers
- **Subtree zoom**: magnifying glass icon per parent span to re-scale timeline to that subtree
- **Batch collapse/expand**: context menu (three dots) per span with options like "Collapse spans at this depth", "Collapse spans with this ServiceName and Name"
- **Span events**: shown as circles on the duration bar at their timestamp positions; click opens Events tab in sidebar
- **Keyboard navigation** supported

#### Section 4: Trace Sidebar (right panel)

- Appears when a span is selected
- Three tabs:
  - **Fields**: key-value table of all span attributes. Filter input at top. Error field highlighted at top of list. Three-dot menu per field with GROUP BY / WHERE actions (for Honeycomb query builder integration).
  - **Span Events**: list of span events with timestamp, name, expandable attributes
  - **Links**: list of span links with linked traceId/spanId and attributes
- **Minigraph** at top: heatmap view of selected span relative to others with same fields
- **Sidebar filter**: text filter that persists across span selections

---

## 4. NPM Packages

### OTLP Protobuf Parsing

| Package                                    | Weekly Downloads | Notes                                                                                                                                 |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `protobufjs` (v8)                          | 32M              | Decode binary protobuf from `.proto` files. Pure JS. `Message.decode(buffer)` + `Message.toObject()`. 7x faster than google-protobuf. |
| `@opentelemetry/otlp-transformer` (v0.212) | 14M              | Serialize/deserialize OTLP payloads. Marked "internal use only". Deserializers are response-focused.                                  |

**Recommendation**: For binary protobuf, use `protobufjs` directly with `.proto` files from the [opentelemetry-proto](https://github.com/open-telemetry/opentelemetry-proto) repo. For JSON-only (our v1 approach), no protobuf library is needed — just `request.json()`.

### UI / Visualization

No Svelte-specific trace/gantt library exists. All serious trace viewers (Jaeger, Honeycomb, otel-desktop-viewer) use **custom HTML/CSS waterfalls**. Recommended approach: `<div>` bars with calculated `left` and `width` percentages.

### Core Packages

| Package                    | Purpose                       |
| -------------------------- | ----------------------------- |
| `svelte` + `@sveltejs/kit` | Framework                     |
| `@sveltejs/adapter-node`   | Persistent Node.js server     |
| `protobufjs`               | Binary protobuf decoding (v2) |

---

## 5. Existing Lightweight OTLP Viewers

| Project                                                                        | Stack            | Notes                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [otel-desktop-viewer](https://github.com/CtrlSpice/otel-desktop-viewer) (752★) | Go + React       | CLI tool built on OTel Collector. DuckDB storage, JSON-RPC for frontend. React frontend embedded in Go binary. gRPC + HTTP on ports 4317/4318. |
| [otel-tui](https://github.com/ymtdzzz/otel-tui) (809★)                         | Go (terminal UI) | Terminal-based viewer. Traces, metrics, logs. In-memory with 1000-span buffer.                                                                 |
| Jaeger UI                                                                      | React            | Full-featured but heavyweight. Requires backend (Badger/Cassandra/ES). Gold standard waterfall reference.                                      |

**No existing JavaScript/TypeScript lightweight OTLP trace viewer was found.** This is a clear gap.

---

## 6. Gotchas & Edge Cases

### Protocol

1. **Hex vs Base64 for IDs**: OTLP JSON uses hex-encoded traceId/spanId, NOT base64. If using `protobufjs` with `bytes: String`, it produces base64 — conversion needed.
2. **Timestamps are nanoseconds**: `fixed64` fields are nanoseconds since epoch. In JSON they're string-encoded. JS `Number` only safe up to 2^53, so use `BigInt` or keep as strings and divide by 1e6 for ms precision.
3. **Enum values are integers**: `kind: 2` not `kind: "SPAN_KIND_SERVER"`. Must map to labels in UI.
4. **Spans arrive incrementally**: A trace's spans may come in multiple requests from different services. Store must merge.
5. **Root span may arrive last**: Tree building must handle orphan spans gracefully.
6. **Empty `parentSpanId`**: In JSON, may be `""` or absent. Both mean root span.
7. **`partial_success` response**: Return `{}` or `{ "partialSuccess": {} }` to avoid SDK warnings.

### SvelteKit

8. **`adapter-node` required**: For in-memory state persistence and SSE. Serverless adapters won't work.
9. **Server-only imports**: Keep trace store in `$lib/server/` to prevent client-side bundling.
10. **`$state.raw()` for large data**: Avoids deep proxying on large span arrays.
11. **SvelteKit's own OTel**: Disable `tracing.server` to prevent self-tracing infinite loops.

### Data Processing

12. **Flatten `KeyValue[]`**: Wire format is `[{key, value: {stringValue|intValue|...}}]`. Must flatten to `{ "http.method": "GET" }`.
13. **`AnyValue` type switching**: 7 variants (`stringValue`, `boolValue`, `intValue`, `doubleValue`, `arrayValue`, `kvlistValue`, `bytesValue`). All must be handled.
14. **gzip decompression**: SvelteKit/Node.js does NOT auto-decompress request bodies. Check `Content-Encoding` header and decompress manually.
15. **Memory management**: Implement max trace count or TTL eviction from the start.
16. **`service.name` extraction**: In `Resource.attributes`, not in span. Must carry from `ResourceSpans` level.
17. **Nanosecond arithmetic**: `BigInt(end) - BigInt(start)` for duration. Convert to ms: `Number(durationNs / 1_000_000n)`.

---

## 7. Architecture Recommendations

### Real-Time Updates: SSE vs WebSocket vs Polling

| Approach           | Pros                                                                | Cons                                                                   | Verdict                                    |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| **Polling**        | Simplest implementation                                             | Higher latency, unnecessary requests                                   | Replaced by SSE                            |
| **SSE**            | Simple, built-in `EventSource` API, uni-directional, auto-reconnect | No binary support                                                      | **Implemented** — `GET /api/traces/stream` |
| **Streaming HTTP** | Same transport as SSE, works with `fetch` + `ReadableStream`        | No built-in reconnect, no event framing — must implement both manually | Inferior to SSE for this use case          |
| **WebSocket**      | Bi-directional, binary                                              | Complex setup, SvelteKit lacks native WS support                       | Overkill                                   |

### Swappable Storage Interface

```typescript
interface TraceStore {
  ingest(resourceSpans: any[]): void
  getTraceList(limit?: number): TraceListItem[]
  getTrace(traceId: string): FullTrace | undefined
  clear(): void
  subscribe(fn: () => void): () => void
}
```

Start with in-memory `Map<string, StoredTrace>`. Swap to SQLite later by implementing the same interface.
