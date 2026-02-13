# Implementation Plan: otel-gui

A lightweight, local OpenTelemetry trace viewer inspired by Honeycomb's trace detail UI.

## Tech Stack

| Layer       | Choice                          | Rationale                                                     |
|-------------|----------------------------------|---------------------------------------------------------------|
| Framework   | SvelteKit 5 (Svelte 5 runes)    | User preference. Full-stack TypeScript. Fast, lightweight.    |
| Adapter     | `@sveltejs/adapter-node`         | Required for persistent in-memory state and SSE support.      |
| Language    | TypeScript                       | Full-stack type safety.                                       |
| Storage     | In-memory (`Map`) behind interface | Simplest for v1. Swappable to SQLite via same interface.     |
| OTLP format | JSON only (v1)                   | No extra dependencies. Most SDKs support JSON export.         |
| Real-time   | Polling 2s (v1)                  | Simplest. Upgrade to SSE in v2.                               |
| Port        | 4318                             | Standard OTLP/HTTP port — zero config on exporter side.       |
| Visualization | Custom HTML/CSS waterfall      | Industry standard approach (Honeycomb, Jaeger all do this).   |

## Architecture

```
┌─────────────────┐    OTLP/HTTP     ┌──────────────────────────────────┐
│ Instrumented    │   POST /v1/traces │         SvelteKit Server          │
│ Application     │──────────────────▶│                                  │
│ (OTel SDK)      │   :4318           │  ┌─────────────┐ ┌────────────┐ │
└─────────────────┘                   │  │ API Route   │ │ In-Memory  │ │
                                      │  │ /v1/traces  │─▶│ TraceStore │ │
                                      │  └─────────────┘ └─────┬──────┘ │
                                      │                        │        │
                                      │  ┌─────────────┐      │        │
                                      │  │ GET /api/*  │◀─────┘        │
                                      │  └──────┬──────┘               │
                                      └─────────┼──────────────────────┘
                                                │ JSON
                                      ┌─────────▼──────────────────────┐
                                      │       Svelte 5 Frontend         │
                                      │  ┌──────────┐ ┌──────────────┐ │
                                      │  │ Trace    │ │ Trace Detail │ │
                                      │  │ List     │ │ (4 sections) │ │
                                      │  └──────────┘ └──────────────┘ │
                                      └────────────────────────────────┘
```

## File Structure

```
src/
├── lib/
│   ├── types.ts                          # TypeScript types (StoredSpan, StoredTrace, etc.)
│   ├── server/
│   │   └── traceStore.ts                 # In-memory TraceStore (server-only)
│   ├── utils/
│   │   ├── attributes.ts                 # flattenAttributes(), extractAnyValue()
│   │   ├── time.ts                       # formatDuration(), formatTimestamp()
│   │   ├── spans.ts                      # spanKindLabel(), statusLabel(), buildSpanTree()
│   │   └── colors.ts                     # Service name → color palette
│   ├── stores/
│   │   └── traces.svelte.ts              # Client-side reactive store (polling)
│   └── components/
│       ├── TraceIdentification.svelte    # Section 1: top bar
│       ├── TraceSummary.svelte           # Section 2: collapsible minimap
│       ├── TraceWaterfall.svelte         # Section 3: waterfall container
│       ├── WaterfallRow.svelte           # Individual span row in waterfall
│       └── SpanSidebar.svelte            # Section 4: span detail sidebar
├── routes/
│   ├── +page.svelte                      # Trace list page
│   ├── +layout.svelte                    # App layout
│   ├── v1/
│   │   └── traces/
│   │       └── +server.ts                # OTLP receiver endpoint
│   ├── api/
│   │   └── traces/
│   │       ├── +server.ts                # GET /api/traces (list)
│   │       └── [traceId]/
│   │           └── +server.ts            # GET /api/traces/:id (detail)
│   └── traces/
│       └── [traceId]/
│           ├── +page.ts                  # Load function
│           └── +page.svelte              # Trace detail page
└── app.html
```

## Implementation Steps

### Phase 1: Project Setup

#### Step 1 — Scaffold SvelteKit project
- `npx sv create` with Svelte 5, TypeScript
- Install `@sveltejs/adapter-node`
- Configure `vite.config.ts` to run dev server on port 4318
- Disable SvelteKit's built-in OTel tracing to prevent self-tracing loops

#### Step 2 — Define TypeScript types (`$lib/types.ts`)
```typescript
interface StoredSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;                        // 0-5 (SpanKind enum)
  startTimeUnixNano: string;           // string to preserve precision
  endTimeUnixNano: string;
  attributes: Record<string, any>;     // flattened from KeyValue[]
  events: SpanEvent[];
  links: SpanLink[];
  status: { code: number; message: string };
  resource: Record<string, any>;       // flattened resource attributes
  scopeName: string;
  scopeVersion: string;
}

interface StoredTrace {
  traceId: string;
  rootSpanName: string;
  serviceName: string;                 // from resource service.name
  startTimeUnixNano: string;           // earliest span start
  endTimeUnixNano: string;             // latest span end
  spanCount: number;
  hasError: boolean;                   // any span with status.code === 2
  spans: Map<string, StoredSpan>;
}

interface TraceListItem {
  traceId: string;
  rootSpanName: string;
  serviceName: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
  startTime: string;                   // ISO timestamp for display
}

interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: Record<string, any>;
}

interface SpanLink {
  traceId: string;
  spanId: string;
  traceState: string;
  attributes: Record<string, any>;
}

// Swappable storage interface
interface TraceStore {
  ingest(resourceSpans: any[]): void;
  getTraceList(limit?: number): TraceListItem[];
  getTrace(traceId: string): StoredTrace | undefined;
  clear(): void;
  subscribe(fn: () => void): () => void;
}
```

#### Step 3 — Implement TraceStore (`$lib/server/traceStore.ts`)
- In-memory `Map<string, StoredTrace>` behind `TraceStore` interface
- `ingest()`: flatten `ResourceSpans → ScopeSpans → Spans` hierarchy, extract `service.name` from `Resource.attributes`, merge spans into existing traces, handle out-of-order root spans
- `getTraceList()`: return sorted summaries (newest first), with configurable limit
- `getTrace()`: return full trace with all spans
- `clear()`: reset all data
- `subscribe()`: listener registration for future SSE support
- Max traces eviction: keep at most 1000 traces, evict oldest when exceeded

#### Step 4 — Utility helpers (`$lib/utils/`)
- `attributes.ts`: `flattenAttributes(keyValues)` handles all 7 `AnyValue` variants (`stringValue`, `boolValue`, `intValue`, `doubleValue`, `arrayValue`, `kvlistValue`, `bytesValue`)
- `time.ts`: `formatDuration(startNano, endNano)` → human-readable string (e.g., "42.3ms"), `formatTimestamp(nanoString)` → ISO string
- `spans.ts`: `spanKindLabel(kind)` → "SERVER"/"CLIENT"/etc., `statusLabel(code)` → "OK"/"ERROR"/"UNSET", `buildSpanTree(spans)` → nested tree structure for waterfall rendering
- `colors.ts`: deterministic color palette based on service name hash

### Phase 2: OTLP Receiver + API

#### Step 5 — OTLP endpoint (`src/routes/v1/traces/+server.ts`)
- `POST` handler
- Check `Content-Type: application/json` → `request.json()`
- Check `Content-Encoding: gzip` → decompress via `DecompressionStream` before parsing
- Call `traceStore.ingest(body.resourceSpans)`
- Return `200` with `{}` body
- Return `400` for malformed requests
- Log `Content-Type: application/x-protobuf` as unsupported (v2)

#### Step 6 — Frontend API routes
- `GET /api/traces` → returns `TraceListItem[]` JSON, sorted by start time descending, limit 100
- `GET /api/traces/[traceId]` → returns full trace JSON with all spans as array (serialize `Map` to array)
- Both call into `traceStore`

### Phase 3: Frontend — Trace List

#### Step 7 — Client-side reactive store (`$lib/stores/traces.svelte.ts`)
- `$state.raw<TraceListItem[]>([])` for trace list (avoids deep proxying overhead)
- `$state<string | null>(null)` for `selectedTraceId`
- `$effect()` with `setInterval` polling `GET /api/traces` every 2s
- Export as module-level runes (`.svelte.ts` file)

#### Step 8 — Trace list page (`src/routes/+page.svelte`)
- Table/list showing: service name, root span name, duration (ms), span count, error indicator (red badge), timestamp
- Click row → `goto('/traces/' + traceId)`
- Header with app title and "Clear traces" button
- Auto-refreshes via the polling store
- Empty state when no traces received yet

### Phase 4: Frontend — Trace Detail (Honeycomb-Inspired)

#### Step 9 — Trace detail page (`src/routes/traces/[traceId]/+page.svelte`)
- Load function in `+page.ts` fetches `/api/traces/[traceId]`
- Layout: vertical stack of 4 sections, with waterfall and sidebar side-by-side

#### Step 10 — Section 1: Trace Identification (`TraceIdentification.svelte`)
- Back arrow → link to trace list
- Trace ID displayed (truncated, with copy-to-clipboard button)
- Metadata: span count, total duration, root span timestamp
- Refresh button to re-fetch trace (picks up late-arriving spans)

#### Step 11 — Section 2: Trace Summary (`TraceSummary.svelte`)
- Collapsible via caret toggle
- Condensed horizontal bar chart: up to 6 rows (one per tree depth level)
- Each row: bars sized proportionally to span duration relative to total trace duration
- Bars color-coded by `service.name`
- Hover: tooltip with span name
- Click bar: scroll to and highlight that span in the waterfall below
- Error highlighting toggle: error spans tinted red

#### Step 12 — Section 3: Waterfall (`TraceWaterfall.svelte` + `WaterfallRow.svelte`)

**Header area**:
- Search box: text search across span name + attribute keys/values
  - Highlights matching spans, shows count (e.g., "3 of 12 spans")
  - Prev/next navigation arrows
- Error count badge (e.g., "2 errors")
- Service color legend

**Waterfall rows** (one per visible span):
- **Column 1 — Span info** (left side, ~40% width):
  - Indentation by tree depth (connected with vertical/horizontal guide lines)
  - Child count box: outlined box with direct child count; click to collapse/expand subtree
    - Collapsed: filled box, shows total subtree size
  - Span name (operation name)
- **Column 2 — Duration bar** (right side, ~60% width):
  - Horizontal bar with `left = (span.start - trace.start) / trace.duration * 100%` and `width = span.duration / trace.duration * 100%`
  - Color by `service.name` (deterministic palette)
  - Duration label on the bar (e.g., "12.4ms")
  - Span event dots: small circles positioned at relative timestamp
- **Row states**:
  - Default: normal background
  - Selected: blue highlight (click to select, updates sidebar)
  - Error: red tint on background and red duration bar when `status.code === 2`
  - Search match: highlighted/bold when matching search term
  - Collapsed: hidden (parent shows filled child-count box)

**Tree rendering logic** (`buildSpanTree()`):
- Build parent→children map from `parentSpanId` → `spanId`
- Handle orphan spans (parentSpanId references a span not in this trace) — attach as top-level
- Sort children by `startTimeUnixNano`
- Flatten tree to ordered list with depth info for rendering

#### Step 13 — Section 4: Span Sidebar (`SpanSidebar.svelte`)
- Slides in from right when a span is selected (click a waterfall row)
- Close button (×) to dismiss
- **Three tabs**:

**Fields tab** (default):
- Filter input at top (search within field names/values)
- Standard fields first: name, kind (label), status (label + message), duration, start time, end time, spanId, traceId, parentSpanId
- Then span attributes (sorted alphabetically)
- Then resource attributes (prefixed with `resource.`)
- Each field: key on left, value on right, in a compact table

**Span Events tab**:
- List of events, each showing:
  - Timestamp (relative to span start, e.g., "+2.1ms")
  - Event name
  - Expandable attributes section

**Links tab**:
- List of span links, each showing:
  - Linked traceId (truncated, copyable)
  - Linked spanId (truncated, copyable)
  - traceState
  - Expandable attributes section

### Phase 5: Polish & Test

#### Step 14 — Styling
- Clean, minimal design (light theme)
- CSS custom properties for the service color palette
- Responsive: sidebar can overlay on narrow screens
- Monospace font for IDs, timestamps, attribute values

#### Step 15 — Test with sample data
- Create a test script that sends sample OTLP JSON to `POST /v1/traces` via `curl`
- Include multi-service traces, error spans, span events, links
- Verify waterfall renders correctly

#### Step 16 — Test with real instrumented app
- Point a real app's exporter: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
- Verify traces flow in and display correctly

---

## Deferred to v2

| Feature | Description |
|---------|-------------|
| Protobuf support | `application/x-protobuf` via `protobufjs` + vendored `.proto` files |
| SSE real-time push | Replace polling with Server-Sent Events |
| Subtree zoom | Magnifying glass per parent span, re-scales timeline |
| Customizable columns | "Fields" button to add attribute columns to waterfall |
| Resizable columns | Drag column borders |
| Change color-by field | Click column header → "Color rows based on this field" |
| Batch collapse/expand | Context menu: "Collapse spans at this depth", "Collapse spans with this ServiceName and Name" |
| Keyboard navigation | Arrow keys to navigate waterfall |
| SQLite persistence | Swap `TraceStore` implementation for on-disk storage |
| Span search in sidebar | Sidebar filter that persists across span selections |
| Minigraph | Heatmap view of selected span relative to others (Honeycomb feature) |

---

## Key Design Decisions

1. **JSON-only OTLP for v1**: Most SDK exporters support JSON. Protobuf adds `protobufjs` + `.proto` file management complexity. JSON can be parsed with built-in `request.json()`.

2. **Polling over SSE for v1**: 2s polling is adequate for a local dev tool. SSE requires `ReadableStream` management and has reconnection quirks. Easy upgrade path.

3. **Custom waterfall over charting library**: No suitable off-the-shelf Svelte trace/gantt component exists. All serious trace viewers build custom waterfalls with CSS-positioned divs.

4. **Port 4318**: Standard OTLP/HTTP port means instrumented apps can point at the viewer with zero config change — just set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

5. **`$state.raw` for trace lists**: Svelte 5's `$state()` deeply proxies objects, which is expensive for large arrays of spans that are replaced wholesale. `$state.raw()` avoids this overhead.

6. **Honeycomb's 4-section layout from day 1**: Even for a simple v1, structuring the detail view into identification / summary / waterfall / sidebar gives a clean, extensible foundation. Some sections (like the summary minimap) can start simple and grow richer.

7. **`service.name` as default color dimension**: Honeycomb defaults to this too. It's the most useful visual cue in multi-service traces.

8. **Store interface for swappable storage**: The `TraceStore` interface allows dropping in SQLite later without touching API routes or frontend code.
