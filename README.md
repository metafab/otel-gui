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

### Quick Demo (Recommended)

Try the interactive e-commerce demo to see all features:

```sh
./demo-ecommerce-trace.sh
```

This demonstrates:
- Multi-service distributed tracing (frontend, backend-api, auth-service, database)
- Incremental span arrival and merging
- Parent-child span hierarchy with deep nesting
- Error handling with automatic retry
- Collapse/expand functionality

### Manual Examples

Point your instrumented application's OTLP exporter to the viewer:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Or send sample traces via curl:

```sh
# Simple trace with 3 spans
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace.json

# E-commerce trace - Part 1 (frontend + backend-api)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-ecommerce-part1.json

# E-commerce trace - Part 2 (auth-service + database with errors)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-ecommerce-part2.json

# Trace with errors (status.code = 2)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-error.json

# Trace with span links (demonstrates distributed tracing)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @sample-trace-links.json
```

The UI auto-refreshes every 2 seconds to show new traces.

For detailed examples and feature exploration guide, see **[SAMPLE_TRACES.md](./SAMPLE_TRACES.md)**.

## Features

- 🔍 **Search & Filter** - Find spans by name, service, attributes, or events
- ⌨️ **Keyboard Navigation** - Navigate span tree with arrow keys (↑↓←→ Enter)
- ❌ **Error Navigation** - Jump between error spans with dedicated controls
- 🌲 **Collapse/Expand** - Hide/show child spans for cleaner viewing
- 📊 **Multi-Service** - Color-coded services with waterfall timeline
- ⚡ **Events Timeline** - Event markers on span timeline with click navigation
- 👁️ **Panel Toggles** - Hide/show trace details and span sidebar
- 🔄 **Incremental Updates** - Handles spans arriving out-of-order

## Documentation

- **[SAMPLE_TRACES.md](./SAMPLE_TRACES.md)** - Sample traces, demo guide, and feature exploration
- **[docs/](./docs)** - Implementation plan, architecture, and research notes
