// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import SpanDetailsSidebar from './SpanDetailsSidebar.svelte'
import type { StoredSpan, TraceLogDetail, TraceLogListItem } from '$lib/types'

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

function makeLog(overrides: Partial<TraceLogListItem> = {}): TraceLogListItem {
  return {
    id: 'log-001',
    traceId: 'trace-abc',
    spanId: 'span-001',
    timeUnixNano: '1700000000020000000',
    observedTimeUnixNano: '1700000000020000000',
    severityNumber: 17,
    severityText: 'ERROR',
    body: 'database timeout',
    ...overrides,
  }
}

function makeLogDetail(overrides: Partial<TraceLogDetail> = {}): TraceLogDetail {
  return {
    id: 'log-001',
    traceId: 'trace-abc',
    spanId: 'span-001',
    timeUnixNano: '1700000000020000000',
    observedTimeUnixNano: '1700000000020000000',
    severityNumber: 17,
    severityText: 'ERROR',
    body: 'database timeout',
    attributes: { 'log.attr': 'value-1' },
    resource: { 'service.name': 'users-service' },
    scopeName: 'logger-scope',
    scopeVersion: '2.1.0',
    scopeAttributes: { 'scope.attr': 'value-2' },
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

  it('highlights event section and only the matched event-name substring', () => {
    const { container } = render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({
          events: [
            {
              name: 'production',
              timeUnixNano: '1700000000010000000',
              attributes: {},
            },
          ],
        }),
        searchQuery: 'duct',
      },
    })

    expect(container.querySelector('.event-item.search-match')).toBeTruthy()

    const highlighted = Array.from(
      container.querySelectorAll('.event-name-segment.is-match'),
    ).map((el) => el.textContent)
    expect(highlighted).toContain('duct')
    expect(highlighted).not.toContain('production')
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

    const highlighted = Array.from(
      container.querySelectorAll('.match-segment.is-match'),
    ).map((el) => el.textContent)
    expect(highlighted).toContain('SELECT * FROM users')
    expect(highlighted).not.toContain('db.statement')
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

    const highlighted = Array.from(
      container.querySelectorAll('.match-segment.is-match'),
    ).map((el) => el.textContent)
    expect(highlighted).toContain('http.method')
    expect(highlighted).not.toContain('GET')
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

  // ── Logs section ─────────────────────────────────────────────────────────

  it('renders logs section when correlated logs are provided for the span', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
      },
    })

    expect(screen.getByText(/Logs/)).toBeInTheDocument()
    expect(screen.getByText('database timeout')).toBeInTheDocument()
  })

  it('hides logs section when there are no correlated logs for current span', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({ spanId: 'span-001' }),
        traceLogs: [makeLog({ spanId: 'span-other' })],
      },
    })

    expect(screen.queryByText(/Logs/)).not.toBeInTheDocument()
    expect(screen.queryByText('cache miss')).not.toBeInTheDocument()
  })

  it('filters correlated logs by text', async () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [
          makeLog({ id: 'log-a', body: 'database timeout', severityText: 'ERROR' }),
          makeLog({ id: 'log-b', body: 'cache miss', severityText: 'INFO', severityNumber: 9 }),
        ],
      },
    })

    const filterInput = screen.getByPlaceholderText(
      'Filter logs by severity/text...',
    )
    await fireEvent.input(filterInput, { target: { value: 'cache' } })

    expect(screen.queryByText('database timeout')).not.toBeInTheDocument()
    expect(screen.getByText('cache miss')).toBeInTheDocument()
  })

  it('calls onSelectLog when selecting a log record in the current span', async () => {
    const onSelectLog = vi.fn()
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
        onSelectLog,
      },
    })

    await fireEvent.click(screen.getByTitle('Select log record'))
    expect(onSelectLog).toHaveBeenCalledWith('log-001', 'span-001')
  })

  it('hides Select log button when the log is already selected', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
        selectedLogId: 'log-001',
      },
    })

    expect(screen.queryByTitle('Select log record')).not.toBeInTheDocument()
  })

  it('uses jump-to-log action for logs linked to another span', async () => {
    const onSelectLog = vi.fn()
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({ spanId: 'span-001' }),
        traceLogs: [
          makeLog({ id: 'log-self', spanId: 'span-001' }),
          makeLog({ id: 'log-other', spanId: 'span-other' }),
        ],
        onSelectLog,
      },
    })

    await fireEvent.click(screen.getByLabelText('Current span only'))
    expect(screen.getByTitle('Jump to log record')).toBeInTheDocument()
    await fireEvent.click(screen.getByTitle('Jump to log record'))
    expect(onSelectLog).toHaveBeenCalledWith('log-other', 'span-other')
  })

  it('calls onOpenLogDetail when show details is clicked', async () => {
    const onOpenLogDetail = vi.fn()
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
        onOpenLogDetail,
      },
    })

    await fireEvent.click(screen.getByTitle('Show full log details'))
    expect(onOpenLogDetail).toHaveBeenCalledWith('log-001')
  })

  it('renders attributes/resource/scope for the selected detailed log', () => {
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
        selectedLogId: 'log-001',
        logDetailsById: { 'log-001': makeLogDetail() },
      },
    })

    expect(screen.getByText('Show details')).toBeInTheDocument()
  })

  it('allows hiding full log detail after opening it', async () => {
    const onOpenLogDetail = vi.fn()
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan(),
        traceLogs: [makeLog()],
        selectedLogId: 'log-001',
        logDetailsById: { 'log-001': makeLogDetail() },
        onOpenLogDetail,
      },
    })

    const openButton = screen.getByTitle('Show full log details')
    await fireEvent.click(openButton)
    expect(onOpenLogDetail).toHaveBeenCalledWith('log-001')

    expect(screen.getByText('Hide details')).toBeInTheDocument()
    expect(screen.getByText('Attributes')).toBeInTheDocument()
    expect(screen.getByText('Resource')).toBeInTheDocument()
    expect(screen.getAllByText('Scope').length).toBeGreaterThan(0)
    expect(screen.getByText('log.attr')).toBeInTheDocument()
    expect(screen.getByText('scope.attr')).toBeInTheDocument()
    expect(screen.getByText('logger-scope')).toBeInTheDocument()
    expect(screen.getByText('2.1.0')).toBeInTheDocument()

    await fireEvent.click(screen.getByTitle('Hide full log details'))
    expect(screen.queryByText('Attributes')).not.toBeInTheDocument()
    expect(screen.queryByText('Resource')).not.toBeInTheDocument()
    expect(screen.queryByText('logger-scope')).not.toBeInTheDocument()
  })

  it('allows showing details for multiple logs at the same time', async () => {
    const onOpenLogDetail = vi.fn()
    render(SpanDetailsSidebar, {
      props: {
        span: makeSpan({ spanId: 'span-001' }),
        traceLogs: [
          makeLog({
            id: 'log-001',
            spanId: 'span-001',
            body: 'first log body',
          }),
          makeLog({
            id: 'log-002',
            spanId: 'span-001',
            body: 'second log body',
          }),
        ],
        logDetailsById: {
          'log-001': makeLogDetail({
            id: 'log-001',
            attributes: { 'log.attr': 'value-1' },
          }),
          'log-002': makeLogDetail({
            id: 'log-002',
            attributes: { 'log.attr': 'value-2' },
          }),
        },
        onOpenLogDetail,
      },
    })

    const showButtons = screen.getAllByTitle('Show full log details')
    await fireEvent.click(showButtons[0])
    await fireEvent.click(showButtons[1])

    expect(onOpenLogDetail).toHaveBeenNthCalledWith(1, 'log-001')
    expect(onOpenLogDetail).toHaveBeenNthCalledWith(2, 'log-002')
    expect(screen.getAllByText('value-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('value-2').length).toBeGreaterThan(0)
  })
})
