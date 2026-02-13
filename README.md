# otel-gui

A lightweight, local OpenTelemetry trace viewer inspired by Honeycomb's trace detail UI. Built with SvelteKit 5.

## Quick Start

```sh
# install dependencies
pnpm install
```

## Developing

Start the development server on port 4318 (standard OTLP/HTTP port):

```sh
pnpm run dev
```

The viewer will be accessible at `http://localhost:4318` and will receive OTLP traces at `POST http://localhost:4318/v1/traces`.

## Building

To create a production version:

```sh
pnpm run build
```

Preview the production build with `pnpm run preview`.

## Sending Traces

Point your instrumented application's OTLP exporter to the viewer:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Or send sample traces via curl:

```sh
# Send a successful trace with 3 spans
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace.json

# Send a trace with errors (status.code = 2)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-error.json

# Send a trace with span links (demonstrates distributed tracing)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-links.json
```

The UI auto-refreshes every 2 seconds to show new traces.

## Documentation

See [docs/](./docs) for implementation plan and research notes.
