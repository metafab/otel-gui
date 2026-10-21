# HTTP API for scripts and agents

otel-gui exposes JSON endpoints for reading retained telemetry and managing the
local store. This can be useful to scripts and agents that can make HTTP
requests but do not use MCP.

This is documentation of the API as it currently exists, not a promise of a
versioned or compatibility-guaranteed public API. The HTTP routes are used by
the otel-gui UI and may change with the application.

## Discovery and alternatives

- [OpenAPI specification](../static/openapi.yaml) describes the `/api/*` HTTP
  routes.
- The deployed server serves the same specification at `/openapi.yaml`.
- [MCP setup](../README.md#connect-an-ai-agent-with-mcp) is the alternative for
  agents that support MCP. MCP provides purpose-built search tools; the HTTP
  API does not have general-purpose trace, log, or metric search endpoints.
- [OTLP ingestion](../README.md#sending-traces) uses the standard `/v1/traces`,
  `/v1/logs`, and `/v1/metrics` endpoints. Those are separate from this read
  API.

## Base URL and access

The default base URL is `http://localhost:4318`; change the host and port to
match the running instance. The API returns JSON unless an endpoint is an
event stream.

The HTTP API has no authentication or authorization. Treat telemetry as
sensitive: do not expose the server to untrusted networks unless network-level
access controls or a trusted authenticating reverse proxy protect it. The
`OTEL_GUI_CORS_ALLOWED_ORIGINS` setting controls browser CORS behavior only; it
does not authenticate clients or prevent direct HTTP requests. This differs
from the MCP endpoint, which by default restricts clients to loopback.

The endpoints read from the retained store, not an archive. The default memory
backend is volatile and applies configured retention limits. Check `GET
/api/config` for the limits and persistence status of the running instance.
List endpoints return a bounded list, not a cursor-paginated result.

## Read telemetry

### Traces

| Method and path                                    | Description                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /api/traces?limit=N`                          | List traces, newest first. Default limit is 100; the configured trace retention limit is the maximum. |
| `GET /api/traces/{traceId}`                        | Get a trace and its spans, keyed by span ID.                                                          |
| `GET /api/traces/{traceId}/logs?limit=N&spanId=ID` | Get correlated logs for a trace. Default limit is 100; maximum is 5000. `spanId` is optional.         |
| `GET /api/traces/{traceId}/logs/{logId}`           | Get one log, only if it belongs to the requested trace.                                               |
| `GET /api/traces/{traceId}/export`                 | Export one trace in an otel-gui JSON envelope.                                                        |

Trace timestamps such as `startTimeUnixNano` and `endTimeUnixNano` are decimal
nanosecond strings. The trace detail response serializes its spans as a JSON
object keyed by span ID.

### Logs

| Method and path         | Description                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/logs?limit=N` | List retained logs. Default limit is 500; the configured log retention limit is the maximum. |
| `GET /api/logs/{logId}` | Get one retained log with its resource and scope data.                                       |

List records can have `traceId` and `spanId` set to `null` when a log is not
correlated with a trace/span. Use the trace-scoped route when you need to
restrict logs to one trace or span.

### Metrics and service map

| Method and path                   | Description                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/metrics?limit=N`        | List retained metrics. Default limit is 500; the configured metric retention limit is the maximum. |
| `GET /api/metrics/{metricId}`     | Get a metric and all retained series/points. Sum points may include a computed per-second `rate`.  |
| `GET /api/service-map?traceId=ID` | Get the aggregated service map, optionally scoped to one trace.                                    |

Metric point timestamps (`t`) are epoch milliseconds. Metric detail `type`
determines the point shape (`gauge`, `sum`, `histogram`, `exp_histogram`, or
`summary`).

The UI presents monotonic Sum metrics as **Counters** and non-monotonic Sum
metrics as **UpDownCounters**. The API continues to use the OTLP `sum` type;
`isMonotonic` is included in metric list and detail responses so clients can
distinguish those instrument semantics.

### Runtime config

`GET /api/config` returns `maxTraces`, `maxLogs`, `maxMetrics`,
`maxMetricPoints`, and a `persistence` status object. Use the values returned by
the running instance rather than assuming defaults.

## Streaming updates

For a continuing view, use Server-Sent Events (SSE):

- `GET /api/stream` sends initial trace, log, and metric snapshots, then
  updates. Events include `traces`, `logs-count`, `logs-snapshot`,
  `logs-append`, `metrics-count`, `metrics-snapshot`, and `metrics-append`.
- `GET /api/metrics/{metricId}/stream` sends `metric-snapshot` events for the
  selected metric, or `metric-removed` if it is no longer retained.

Responses use `Content-Type: text/event-stream`. Event payloads are JSON except
the count events, whose payloads are decimal strings. Heartbeat comments are
sent periodically and are not data events.

## Examples

List recent traces and inspect one:

```sh
curl --get 'http://localhost:4318/api/traces' \
  --data-urlencode 'limit=20'

curl 'http://localhost:4318/api/traces/TRACE_ID'
```

Read correlated logs and a service map for that trace:

```sh
curl --get 'http://localhost:4318/api/traces/TRACE_ID/logs' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'spanId=SPAN_ID'

curl --get 'http://localhost:4318/api/service-map' \
  --data-urlencode 'traceId=TRACE_ID'
```

List metrics and inspect one:

```sh
curl 'http://localhost:4318/api/metrics?limit=100'
curl 'http://localhost:4318/api/metrics/METRIC_ID'
```

Path IDs must be URL-encoded when they contain reserved characters. Use a URL
encoder rather than interpolating untrusted IDs into a path.

## Mutating and bulk operations

The API also has operations that change retained data. These are not needed for
read-only agent access; do not call them unless the task explicitly requires
the side effect.

| Method and path                   | Effect                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `DELETE /api/traces`              | Clears all traces by default; with JSON `{ "traceIds": ["..."] }`, deletes only those traces. |
| `DELETE /api/logs`                | Clears all logs by default; with JSON `{ "logIds": ["..."] }`, deletes only those logs.       |
| `DELETE /api/metrics`             | Clears all metrics by default; with JSON `{ "ids": ["..."] }`, deletes only those metrics.    |
| `POST /api/traces/export`         | Exports the non-empty set of trace IDs in JSON `{ "traceIds": ["..."] }`.                     |
| `POST /api/traces/import/preview` | Validates import content and returns metadata without ingesting it.                           |
| `POST /api/traces/import`         | Imports trace data into the retained store.                                                   |
| `POST /api/logs/export`           | Exports the non-empty set of log IDs in JSON `{ "logIds": ["..."] }`.                         |
| `POST /api/logs/import/preview`   | Validates log import content and returns metadata without ingesting it.                       |
| `POST /api/logs/import`           | Imports log data into the retained store.                                                     |

**Important:** For the three `DELETE` endpoints, omitting the JSON array property
(or sending a non-JSON body) clears the entire signal. An empty array performs a
selected deletion of zero items. Send `Content-Type: application/json` and the
correct ID property when deleting selected items. Malformed JSON returns
`400`.

Import requests have JSON shape
`{ "content": "<JSON text>", "fileName": "optional-name.json" }`. `content` may
contain an OTLP JSON trace payload or an otel-gui trace export envelope. The
UTF-8 content limit is 10 MiB. Preview first; a successful import can merge with
existing traces and may evict older traces when retention is full.

Log import uses the same request shape. `content` may contain an OTLP JSON
`resourceLogs` payload or an otel-gui log export envelope
(`format: "otel-gui-log-export"`). Envelope records are stamped with a
`log.record.uid` attribute (the exported log ID) when they have none, so
re-importing an export overwrites the original logs instead of duplicating them.
Imports may evict older logs when log retention is full.

## Errors and limits

- Missing trace, log, or metric IDs return `404`.
- Invalid import/export payloads return `400`; export with no matching traces
  returns `404`.
- Non-positive or unparseable `limit` values use the endpoint default. Positive
  list limits are capped by the configured retention limit; trace-scoped logs
  are capped at 5000.
- General text search and arbitrary filters are not provided by these HTTP
  routes. MCP tools provide server-side search when an MCP client is available.
