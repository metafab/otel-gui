// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import SpanDetailsSidebar from './SpanDetailsSidebar.svelte'
import type { StoredSpan } from '$lib/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

function makeSpan(overrides: Partial<StoredSpan> = {}): StoredSpan {
  return {
    traceId: 'trace-abc',
    spanId: 'span-001',
    parentSpanId: '',
    name: 'HTTP GET /api/users',
    kind: 2, // SERVER
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000000050000000',
    attributes: {},
    events: [],
    links: [],
    status: { code: 0, message: '' },
    resource: { 'service.name': 'users-service' },
    scopeName: 'my-scope',
    scopeVersion: '1.0.0',
    scopeAttributes: {},
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SpanDetailsSidebar', () => {
  // ── Basic field rendering ─────────────────────────────────────────────────

  it('renders the span name', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan() } })
    expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument()
  })

  it('renders the span kind label', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan({ kind: 2 }) } })
    expect(screen.getByText('SERVER')).toBeInTheDocument()
  })

  it('renders UNSET status for code 0', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ status: { code: 0, message: '' } }) },
    })
    expect(screen.getByText('UNSET')).toBeInTheDocument()
  })

  it('renders OK status for code 1', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ status: { code: 1, message: '' } }) },
    })
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('renders ERROR status for code 2', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ status: { code: 2, message: '' } }) },
    })
    expect(screen.getByText('ERROR')).toBeInTheDocument()
  })

  it('appends status message when present', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          status: { code: 2, message: 'something went wrong' },
        }),
      },
    })
    expect(screen.getByText(/something went wrong/)).toBeInTheDocument()
  })

  it('renders the span ID', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan() } })
    expect(screen.getByText('span-001')).toBeInTheDocument()
  })

  it('renders the service name from resource', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan() } })
    expect(screen.getByText('users-service')).toBeInTheDocument()
  })

  it('highlights span ID when search query matches it', () => {
    const { container } = render(SpanDetailsSidebar, {
      props: { span: makeSpan({ spanId: 'abc123def' }), searchQuery: '123d' },
    })

    const matched = container.querySelector('.value.mono.search-match')
    expect(matched).toBeTruthy()
    expect(matched?.textContent).toContain('abc123def')
  })

  // ── Parent span link ──────────────────────────────────────────────────────

  it('does not show Parent ID row when parentSpanId is empty', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ parentSpanId: '' }) },
    })
    expect(screen.queryByTitle('Jump to parent span')).not.toBeInTheDocument()
  })

  it('shows parent ID button when parentSpanId is set', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ parentSpanId: 'parent-xyz' }) },
    })
    expect(screen.getByTitle('Jump to parent span')).toBeInTheDocument()
    expect(screen.getByText('parent-xyz')).toBeInTheDocument()
  })

  it('calls onSelectSpan with the parent ID when the parent button is clicked', async () => {
    const onSelectSpan = vi.fn()
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ parentSpanId: 'parent-xyz' }), onSelectSpan },
    })
    await fireEvent.click(screen.getByTitle('Jump to parent span'))
    expect(onSelectSpan).toHaveBeenCalledWith('parent-xyz')
  })

  // ── Attributes section ────────────────────────────────────────────────────

  it('does not render the Attributes section when span has no attributes', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ attributes: {} }) },
    })
    expect(screen.queryByText(/^Attributes/)).not.toBeInTheDocument()
  })

  it('renders the Attributes section with count when attributes are present', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          attributes: { 'http.method': 'GET', 'http.status_code': 200 },
        }),
      },
    })
    expect(screen.getByText('Attributes (2)')).toBeInTheDocument()
  })

  it('renders each attribute key', () => {
    render(SpanDetailsSidebar, {
      props: { span: makeSpan({ attributes: { 'http.method': 'POST' } }) },
    })
    expect(screen.getByText('http.method')).toBeInTheDocument()
  })

  it('filters attributes by query', async () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          attributes: { 'http.method': 'GET', 'db.system': 'postgresql' },
        }),
      },
    })
    const filterInput = screen.getByPlaceholderText('Filter attributes...')
    await fireEvent.input(filterInput, { target: { value: 'db' } })
    expect(screen.getByText('db.system')).toBeInTheDocument()
    expect(screen.queryByText('http.method')).not.toBeInTheDocument()
  })

  // ── Events section ────────────────────────────────────────────────────────

  it('does not render the Events section when span has no events', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan({ events: [] }) } })
    expect(screen.queryByText(/^Events/)).not.toBeInTheDocument()
  })

  it('renders the Events section with count', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          events: [
            {
              name: 'exception',
              timeUnixNano: '1700000000010000000',
              attributes: {},
            },
          ],
        }),
      },
    })
    expect(screen.getByText('Events (1)')).toBeInTheDocument()
  })

  it('renders event names', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          events: [
            {
              name: 'exception.stacktrace',
              timeUnixNano: '1700000000010000000',
              attributes: {},
            },
          ],
        }),
      },
    })
    expect(screen.getByText('exception.stacktrace')).toBeInTheDocument()
  })

  it('highlights event section when search query matches event name', () => {
    const { container } = render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          events: [
            {
              name: 'db.query',
              timeUnixNano: '1700000000010000000',
              attributes: {},
            },
          ],
        }),
        searchQuery: 'db.query',
      },
    })

    expect(container.querySelector('.event-item.search-match')).toBeTruthy()
  })

  it('highlights only attribute value when search query matches value', () => {
    const { container } = render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          attributes: {
            'http.method': 'GET',
            'db.statement': 'SELECT * FROM users',
          },
        }),
        searchQuery: 'select * from users',
      },
    })

    expect(container.querySelector('.attr-value.search-match')).toBeTruthy()
    expect(container.querySelector('.attr-key.search-match')).toBeNull()
  })

  it('highlights only attribute key when search query matches key', () => {
    const { container } = render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          attributes: {
            'http.method': 'GET',
          },
        }),
        searchQuery: 'http.method',
      },
    })

    expect(container.querySelector('.attr-key.search-match')).toBeTruthy()
    expect(container.querySelector('.attr-value.search-match')).toBeNull()
  })

  // ── Links section ─────────────────────────────────────────────────────────

  it('does not render the Links section when span has no links', () => {
    render(SpanDetailsSidebar, { props: { span: makeSpan({ links: [] }) } })
    expect(screen.queryByText(/^Links/)).not.toBeInTheDocument()
  })

  it('renders the Links section with a linked trace anchor', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          links: [
            {
              traceId: 'linked-trace',
              spanId: 'linked-span',
              traceState: '',
              attributes: {},
            },
          ],
        }),
      },
    })
    expect(screen.getByText('Links (1)')).toBeInTheDocument()
    expect(screen.getByTitle('Open linked trace')).toBeInTheDocument()
  })

  // ── Resource section ─────────────────────────────────────────────────────

  it('resource section is collapsed by default', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          resource: { 'service.name': 'svc', 'host.name': 'prod-01' },
        }),
      },
    })
    // Toggle button present but content not expanded
    const toggle = screen.getByTitle('Expand resource')
    expect(toggle).toBeInTheDocument()
    expect(screen.queryByText('host.name')).not.toBeInTheDocument()
  })

  it('expands resource section on toggle click', async () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          resource: { 'service.name': 'svc', 'host.name': 'prod-01' },
        }),
      },
    })
    await fireEvent.click(screen.getByTitle('Expand resource'))
    expect(screen.getByText('host.name')).toBeInTheDocument()
  })
})
