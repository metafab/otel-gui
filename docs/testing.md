# Testing Strategy

## Philosophy

**Test what matters**: Focus on critical OTLP data transformations and business logic. UI component testing deferred until v2 when the interface stabilizes.

**Type safety first**: TypeScript strict mode + `pnpm run check` catches most errors. Tests supplement, not replace, type checking.

## Testing Layers

### 1. Unit Tests (High Priority)

**What to test**:
- OTLP data transformations (critical path)
- Utility functions with complex logic
- Edge cases in data handling

**Tools**: Vitest (fast, Vite-native)

#### Critical Test Cases

**`flattenAttributes()` ([src/lib/utils/attributes.ts](../src/lib/utils/attributes.ts))**:
- All 7 AnyValue variants (`stringValue`, `boolValue`, `intValue`, `doubleValue`, `arrayValue`, `kvlistValue`, `bytesValue`)
- Nested KeyValue lists
- Empty/undefined inputs

```typescript
import { describe, it, expect } from 'vitest';
import { flattenAttributes } from '$lib/utils/attributes';

describe('flattenAttributes', () => {
  it('handles stringValue', () => {
    expect(flattenAttributes([
      { key: 'http.method', value: { stringValue: 'GET' } }
    ])).toEqual({ 'http.method': 'GET' });
  });

  it('handles nested kvlistValue', () => {
    expect(flattenAttributes([
      { key: 'metadata', value: { 
        kvlistValue: { values: [
          { key: 'user.id', value: { stringValue: '123' } }
        ]}
      }}
    ])).toEqual({ metadata: { 'user.id': '123' } });
  });
});
```

**Time formatting ([src/lib/utils/time.ts](../src/lib/utils/time.ts))**:
- BigInt arithmetic correctness
- Edge cases: sub-microsecond, hours+ durations
- Timestamp overflow handling

```typescript
describe('formatDuration', () => {
  it('formats milliseconds with precision', () => {
    expect(formatDuration('1000000000', '1012345678'))
      .toBe('12.3ms');
  });

  it('handles sub-millisecond durations', () => {
    expect(formatDuration('1000000000', '1000000500'))
      .toBe('500µs');
  });
});
```

**Span tree building ([src/lib/utils/spans.ts](../src/lib/utils/spans.ts))**:
- Parent-child relationships
- Orphan spans (parentSpanId references missing span)
- Out-of-order root spans
- Circular references (malformed data)

**TraceStore ([src/lib/server/traceStore.ts](../src/lib/server/traceStore.ts))**:
- Span merging across multiple ingestions
- FIFO eviction at MAX_TRACES limit
- Root span name updates when root arrives late
- Error flag propagation

### 2. Integration Tests (Medium Priority)

**What to test**:
- OTLP endpoint E2E flow: POST → ingestion → storage → API retrieval
- Multi-service trace reconstruction
- Incremental span arrival (root span last)

**Approach**: Use SvelteKit's built-in testing utilities

```typescript
import { describe, it, expect } from 'vitest';
import { POST as otlpReceiver } from '$routes/v1/traces/+server';
import { GET as getTraces } from '$routes/api/traces/+server';

describe('OTLP E2E', () => {
  it('ingests trace and retrieves via API', async () => {
    const otlpPayload = {
      resourceSpans: [{
        resource: { attributes: [
          { key: 'service.name', value: { stringValue: 'test-svc' } }
        ]},
        scopeSpans: [{
          spans: [{
            traceId: 'abc123',
            spanId: 'span1',
            name: 'GET /api',
            startTimeUnixNano: '1000000000',
            endTimeUnixNano: '1050000000'
          }]
        }]
      }]
    };

    // Ingest
    const request = new Request('http://localhost/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otlpPayload)
    });
    await otlpReceiver({ request });

    // Retrieve
    const listRequest = new Request('http://localhost/api/traces');
    const response = await getTraces({ url: new URL(listRequest.url) });
    const traces = await response.json();

    expect(traces).toHaveLength(1);
    expect(traces[0].serviceName).toBe('test-svc');
  });
});
```

### 3. Component Tests (Low Priority - v2)

**Defer until UI stabilizes**. When implemented:
- Use `@testing-library/svelte` for component interaction testing
- Focus on complex components (waterfall, span detail sidebar)
- Test user interactions, not implementation details

### 4. E2E Tests

**Tool**: Playwright

**Use cases**:
- Send real OTLP traces from instrumented app
- Verify waterfall rendering
- Test search/filter interactions

**Current baseline**:
- `tests/e2e/traces.spec.ts` covers OTLP ingest (`POST /v1/traces`) and verifies trace list + trace detail navigation in the browser.
- Also covers keyboard shortcuts and search behavior (`/`, `Esc`, `m`) on trace list and trace detail pages.
- Covers trace-detail mini service map toggling via button and keyboard (`m`).
- Covers error span keyboard navigation on trace detail (`e` / `Shift+E`).
- Covers waterfall tree keyboard navigation on trace detail (`↑↓←→`, `Enter`).
- Covers sidebar section flows on trace detail (Events, Links, and Attributes filtering).

## Test Data

### Sample OTLP Payloads

Create reusable test fixtures in `tests/fixtures/`:

**`tests/fixtures/simple-trace.json`**:
```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        { "key": "service.name", "value": { "stringValue": "frontend" } }
      ]
    },
    "scopeSpans": [{
      "scope": { "name": "my-tracer", "version": "1.0.0" },
      "spans": [{
        "traceId": "5B8EFFF798038103D269B633813FC60C",
        "spanId": "EEE19B7EC3C1B174",
        "parentSpanId": "",
        "name": "GET /",
        "kind": 2,
        "startTimeUnixNano": "1544712660000000000",
        "endTimeUnixNano": "1544712661000000000",
        "attributes": [
          { "key": "http.method", "value": { "stringValue": "GET" } },
          { "key": "http.status_code", "value": { "intValue": "200" } }
        ],
        "status": { "code": 1 }
      }]
    }]
  }]
}
```

**`tests/fixtures/multi-service-trace.json`**: Frontend → Backend → Database spans

**`tests/fixtures/error-trace.json`**: Trace with `status.code === 2` spans

**`tests/fixtures/out-of-order-spans.json`**: Root span in 2nd batch

## Setup

### Install Vitest

```sh
pnpm add -D vitest @vitest/ui
```

### Add test scripts to package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

### Install Playwright

```sh
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

### Create vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    globals: true,
    environment: 'node' // or 'jsdom' for component tests
  }
});
```

### Directory structure

```
src/
  lib/
    utils/
      attributes.test.ts
      time.test.ts
      spans.test.ts
    server/
      traceStore.test.ts
  routes/
    v1/traces/+server.test.ts
tests/
  fixtures/
    simple-trace.json
    multi-service-trace.json
    error-trace.json
```

## CI Integration

GitHub Actions workflow at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request to `main`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run check  # Type checking
      - run: pnpm run test   # Unit + integration tests
```

## Current Status

**129 tests passing** — run with `pnpm run test`.

| File | Tests |
|------|-------|
| `src/lib/utils/attributes.test.ts` | 17 |
| `src/lib/utils/time.test.ts` | 18 |
| `src/lib/utils/spans.test.ts` | 19 |
| `src/lib/server/traceStore.test.ts` | 22 |
| `src/routes/integration.test.ts` | 20 |
| `src/lib/components/ChevronIcon.test.ts` | 6 |
| `src/lib/components/ServiceBadge.test.ts` | 5 |
| `src/lib/components/AttributeItem.test.ts` | 13 |
| `src/lib/components/KeyboardShortcutsHelp.test.ts` | 9 |

Fixtures live in `tests/fixtures/` (simple-trace, multi-service-trace, error-trace, out-of-order-spans).

**Component test setup**: `@testing-library/svelte` + jsdom. Each component test file includes `// @vitest-environment jsdom`. `vitest.config.ts` sets `resolve.conditions: ['browser']` so Svelte's client bundle (not the SSR bundle) is loaded. The shared setup file (`src/lib/components/setup.ts`) imports `@testing-library/jest-dom/vitest` to extend Vitest's `expect` with DOM matchers.

**Next steps**:
1. Add E2E coverage for trace-detail collapse/expand controls (child badges)
2. Add E2E coverage for fullscreen attribute modal flow (open/copy/close)
3. Add E2E coverage for linked-trace navigation from sidebar links

## Resources

- [Vitest Docs](https://vitest.dev/)
- [SvelteKit Testing](https://kit.svelte.dev/docs/testing)
- [Testing Library Svelte](https://testing-library.com/docs/svelte-testing-library/intro)
