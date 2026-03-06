<script lang="ts">
  import type { StoredSpan, TraceLogDetail, TraceLogListItem } from '$lib/types'
  import AttributeItem from '$lib/components/AttributeItem.svelte'
  import ChevronIcon from '$lib/components/ChevronIcon.svelte'
  import {
    formatDuration,
    formatTimestamp,
    formatTimestampLocal,
    formatRelativeTime,
  } from '$lib/utils/time'
  import { spanKindLabel, statusLabel } from '$lib/utils/spans'

  interface Props {
    span: StoredSpan
    /** Called to jump to a different span by ID (e.g. clicking parent span). */
    onSelectSpan?: (spanId: string) => void
    /** Called when the user opens the fullscreen value viewer. */
    onFullscreen?: (key: string, formatted: string) => void
    /** Correlated logs available for the current trace. */
    traceLogs?: TraceLogListItem[]
    /** Currently highlighted log ID. */
    selectedLogId?: string | null
    /** Called to jump/focus a correlated log (and optionally its span). */
    onSelectLog?: (logId: string, relatedSpanId?: string) => void
    /** Called to load the full detail record for a log. */
    onOpenLogDetail?: (logId: string) => void
    /** Full detail payloads keyed by log ID. */
    logDetailsById?: Record<string, TraceLogDetail>
    /** Loading flags keyed by log ID. */
    loadingLogDetailById?: Record<string, boolean>
    /** Inline errors keyed by log ID when detail loading fails. */
    logDetailErrorsById?: Record<string, string>
    /** Index of the highlighted event (from clicking a WaterfallRow event dot). */
    highlightedEventIndex?: number | null
    /** Global span search query from trace page. */
    searchQuery?: string
  }

  let {
    span,
    onSelectSpan,
    onFullscreen,
    traceLogs = [],
    selectedLogId = null,
    onSelectLog,
    onOpenLogDetail,
    logDetailsById = {},
    loadingLogDetailById = {},
    logDetailErrorsById = {},
    highlightedEventIndex = null,
    searchQuery = '',
  }: Props = $props()

  const normalizedSearchQuery = $derived(searchQuery.trim().toLowerCase())

  function valueMatchesSearch(value: unknown): boolean {
    if (!normalizedSearchQuery) return false
    if (value == null) return false
    if (typeof value === 'string') {
      return value.toLowerCase().includes(normalizedSearchQuery)
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(normalizedSearchQuery)
    }

    try {
      const serialized = JSON.stringify(value)
      return (
        typeof serialized === 'string' &&
        serialized.toLowerCase().includes(normalizedSearchQuery)
      )
    } catch {
      return false
    }
  }

  function keyValueMatchesSearch(key: string, value: unknown): boolean {
    if (!normalizedSearchQuery) return false
    return (
      key.toLowerCase().includes(normalizedSearchQuery) ||
      valueMatchesSearch(value)
    )
  }

  function keyMatchesSearch(key: string): boolean {
    return (
      !!normalizedSearchQuery &&
      key.toLowerCase().includes(normalizedSearchQuery)
    )
  }

  function textMatchesSearch(text: string): boolean {
    return (
      !!normalizedSearchQuery &&
      text.toLowerCase().includes(normalizedSearchQuery)
    )
  }

  type MatchSegment = {
    text: string
    isMatch: boolean
  }

  function splitByQuery(text: string, query: string): MatchSegment[] {
    if (!query) return [{ text, isMatch: false }]

    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const segments: MatchSegment[] = []
    let cursor = 0

    while (cursor < text.length) {
      const matchAt = lowerText.indexOf(lowerQuery, cursor)
      if (matchAt === -1) {
        segments.push({ text: text.slice(cursor), isMatch: false })
        break
      }

      if (matchAt > cursor) {
        segments.push({ text: text.slice(cursor, matchAt), isMatch: false })
      }

      segments.push({
        text: text.slice(matchAt, matchAt + lowerQuery.length),
        isMatch: true,
      })
      cursor = matchAt + lowerQuery.length
    }

    return segments
  }

  function eventNameSegments(eventName: string): MatchSegment[] {
    if (!normalizedSearchQuery || !textMatchesSearch(eventName)) {
      return [{ text: eventName, isMatch: false }]
    }
    return splitByQuery(eventName, normalizedSearchQuery)
  }

  function eventMatchesSearch(event: StoredSpan['events'][number]): boolean {
    if (textMatchesSearch(event.name)) return true
    for (const [key, value] of Object.entries(event.attributes)) {
      if (keyValueMatchesSearch(key, value)) return true
    }
    return false
  }

  function normalizeLogBody(body: unknown): string {
    if (body == null) return ''
    if (
      typeof body === 'string' ||
      typeof body === 'number' ||
      typeof body === 'boolean'
    ) {
      return String(body)
    }

    try {
      return JSON.stringify(body)
    } catch {
      return ''
    }
  }

  function severityBucket(
    log: TraceLogListItem,
  ): 'trace' | 'debug' | 'info' | 'warn' | 'error' {
    const n = Number(log.severityNumber) || 0
    if (n >= 17) return 'error'
    if (n >= 13) return 'warn'
    if (n >= 9) return 'info'
    if (n >= 5) return 'debug'
    return 'trace'
  }

  // Per-section filter state (local, resets when span changes)
  let attributeFilter = $state('')
  let resourceFilter = $state('')
  let scopeFilter = $state('')
  let logTextFilter = $state('')
  let logSeverityFilter = $state<
    'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error'
  >('all')
  let logsCollapsed = $state(false)
  let logsOnlyCurrentSpan = $state(true)
  let openLogDetailIds = $state<string[]>([])
  let eventsCollapsed = $state(false)
  let attributesCollapsed = $state(false)
  let resourceCollapsed = $state(true)
  let scopeCollapsed = $state(true)

  // Reset filters and collapsed state when the displayed span changes
  $effect(() => {
    span // reactive dependency
    attributeFilter = ''
    resourceFilter = ''
    scopeFilter = ''
    logTextFilter = ''
    logSeverityFilter = 'all'
    logsOnlyCurrentSpan = true
    openLogDetailIds = []
    resourceCollapsed = true
    scopeCollapsed = true
  })

  const logsForSection = $derived(
    (logsOnlyCurrentSpan
      ? traceLogs.filter((log) => log.spanId === span.spanId)
      : traceLogs
    ).slice(),
  )

  const filteredLogs = $derived(
    logsForSection
      .filter((log) => {
        if (
          logSeverityFilter !== 'all' &&
          severityBucket(log) !== logSeverityFilter
        ) {
          return false
        }

        const q = logTextFilter.trim().toLowerCase()
        if (!q) return true

        const severity = (log.severityText || '').toLowerCase()
        const body = normalizeLogBody(log.body).toLowerCase()
        const spanId = (log.spanId || '').toLowerCase()
        return severity.includes(q) || body.includes(q) || spanId.includes(q)
      })
      .sort((a, b) => {
        const aTs = BigInt(a.timeUnixNano || a.observedTimeUnixNano || '0')
        const bTs = BigInt(b.timeUnixNano || b.observedTimeUnixNano || '0')
        return aTs > bTs ? 1 : aTs < bTs ? -1 : 0
      }),
  )

  const totalTraceLogsCount = $derived(traceLogs.length)
  const currentSpanLogsCount = $derived(
    traceLogs.filter((log) => log.spanId === span.spanId).length,
  )

  // Filtered attribute entries
  const allAttributes = $derived(
    Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b)),
  )
  const filteredAttributes = $derived(
    attributeFilter.trim()
      ? allAttributes.filter(([key, value]) => {
          const q = attributeFilter.toLowerCase()
          return (
            key.toLowerCase().includes(q) ||
            JSON.stringify(value).toLowerCase().includes(q)
          )
        })
      : allAttributes,
  )

  const allResourceEntries = $derived(
    Object.entries(span.resource).sort(([a], [b]) => a.localeCompare(b)),
  )
  const filteredResource = $derived(
    resourceFilter.trim()
      ? allResourceEntries.filter(([key, value]) => {
          const q = resourceFilter.toLowerCase()
          return (
            key.toLowerCase().includes(q) ||
            JSON.stringify(value).toLowerCase().includes(q)
          )
        })
      : allResourceEntries,
  )

  const allScopeEntries = $derived(
    Object.entries(span.scopeAttributes).sort(([a], [b]) => a.localeCompare(b)),
  )
  const filteredScope = $derived(
    scopeFilter.trim()
      ? allScopeEntries.filter(([key, value]) => {
          const q = scopeFilter.toLowerCase()
          return (
            key.toLowerCase().includes(q) ||
            JSON.stringify(value).toLowerCase().includes(q)
          )
        })
      : allScopeEntries,
  )

  const hasScope = $derived(
    !!(
      span.scopeName ||
      span.scopeVersion ||
      Object.keys(span.scopeAttributes).length > 0
    ),
  )
</script>

<div class="span-details">
  <!-- Basic fields -->
  <div class="detail-row">
    <span class="label">Name:</span>
    <span class="value" class:search-match={textMatchesSearch(span.name)}
      >{span.name}</span
    >
  </div>
  <div class="detail-row">
    <span class="label">Started:</span>
    <span class="value" title={formatTimestamp(span.startTimeUnixNano)}
      >{formatTimestampLocal(span.startTimeUnixNano)}</span
    >
  </div>
  <div class="detail-row">
    <span class="label">Ended:</span>
    <span class="value" title={formatTimestamp(span.endTimeUnixNano)}
      >{formatTimestampLocal(span.endTimeUnixNano)}</span
    >
  </div>
  <div class="detail-row">
    <span class="label">Duration:</span>
    <span class="value">
      {formatDuration(span.startTimeUnixNano, span.endTimeUnixNano)}
    </span>
  </div>
  <div class="detail-row">
    <span class="label">Kind:</span>
    <span
      class="value"
      class:search-match={textMatchesSearch(spanKindLabel(span.kind))}
      >{spanKindLabel(span.kind)}</span
    >
  </div>
  <div class="detail-row">
    <span class="label">Status:</span>
    <span
      class="value"
      class:status-error={span.status.code === 2}
      class:status-ok={span.status.code === 1}
    >
      {statusLabel(span.status.code)}
      {#if span.status.message}
        - {span.status.message}
      {/if}
    </span>
  </div>
  <div class="detail-row">
    <span class="label">Span ID:</span>
    <span class="value mono" class:search-match={textMatchesSearch(span.spanId)}
      >{span.spanId}</span
    >
  </div>
  {#if span.parentSpanId}
    <div class="detail-row">
      <span class="label">Parent ID:</span>
      <button
        class="value mono parent-link"
        class:search-match={textMatchesSearch(span.parentSpanId)}
        onclick={() => onSelectSpan?.(span.parentSpanId)}
        title="Jump to parent span"
      >
        {span.parentSpanId}
      </button>
    </div>
  {/if}
  <div class="detail-row">
    <span class="label">Service:</span>
    <span
      class="value"
      class:search-match={keyValueMatchesSearch(
        'service.name',
        span.resource['service.name'] || 'unknown',
      )}>{span.resource['service.name'] || 'unknown'}</span
    >
  </div>

  <!-- Events -->
  {#if span.events.length > 0}
    <div class="section-divider"></div>
    <div class="section-header">
      <button
        class="section-toggle"
        onclick={() => (eventsCollapsed = !eventsCollapsed)}
        aria-expanded={!eventsCollapsed}
        title={eventsCollapsed ? 'Expand events' : 'Collapse events'}
      >
        <ChevronIcon expanded={!eventsCollapsed} />
        <h4 class="section-title">Events ({span.events.length})</h4>
      </button>
    </div>
    {#if !eventsCollapsed}
      {#each span.events as event, index}
        <div
          class="event-item"
          id="event-{index}"
          class:highlighted={highlightedEventIndex === index}
          class:search-match={eventMatchesSearch(event)}
        >
          <div class="event-header">
            <div class="event-name">
              {#each eventNameSegments(event.name) as segment}
                <span
                  class="event-name-segment"
                  class:is-match={segment.isMatch}>{segment.text}</span
                >
              {/each}
            </div>
            <div
              class="event-timestamp"
              title={formatTimestamp(event.timeUnixNano)}
            >
              {formatRelativeTime(span.startTimeUnixNano, event.timeUnixNano)}
            </div>
          </div>
          {#if Object.keys(event.attributes).length > 0}
            <div class="event-attributes">
              {#each Object.entries(event.attributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                <AttributeItem
                  attrKey={key}
                  {value}
                  {onFullscreen}
                  highlightKey={keyMatchesSearch(key)}
                  highlightValue={valueMatchesSearch(value)}
                  highlightQuery={searchQuery}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  {/if}

  <!-- Links -->
  {#if span.links.length > 0}
    <div class="section-divider"></div>
    <h4 class="section-title">Links ({span.links.length})</h4>
    {#each span.links as link}
      <div class="link-item">
        <div class="link-info">
          <div class="link-field">
            <span class="link-label">Trace ID:</span>
            <a
              href="/traces/{link.traceId}"
              class="link-value mono link-anchor"
              title="Open linked trace"
            >
              {link.traceId}
            </a>
          </div>
          <div class="link-field">
            <span class="link-label">Span ID:</span>
            <a
              href="/traces/{link.traceId}?spanId={link.spanId}"
              class="link-value mono link-anchor"
              title="Open linked trace and select span"
            >
              {link.spanId}
            </a>
          </div>
          {#if link.traceState}
            <div class="link-field">
              <span class="link-label">State:</span>
              <span class="link-value">{link.traceState}</span>
            </div>
          {/if}
        </div>
        {#if Object.keys(link.attributes).length > 0}
          <div class="link-attributes">
            {#each Object.entries(link.attributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
              <AttributeItem attrKey={key} {value} {onFullscreen} />
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}

  <!-- Correlated Logs -->
  {#if currentSpanLogsCount > 0}
    <div class="section-divider"></div>
    <div class="section-header logs-section-header">
      <button
        class="section-toggle"
        onclick={() => (logsCollapsed = !logsCollapsed)}
        aria-expanded={!logsCollapsed}
        title={logsCollapsed
          ? 'Expand correlated logs'
          : 'Collapse correlated logs'}
      >
        <ChevronIcon expanded={!logsCollapsed} />
        <h4 class="section-title">
          Logs
          {#if logsOnlyCurrentSpan}
            ({filteredLogs.length} of {currentSpanLogsCount})
          {:else}
            ({filteredLogs.length} of {totalTraceLogsCount})
          {/if}
        </h4>
      </button>
      {#if !logsCollapsed}
        <label class="logs-scope-toggle">
          <input type="checkbox" bind:checked={logsOnlyCurrentSpan} />
          Current span only
        </label>
      {/if}
    </div>

    {#if !logsCollapsed}
      <div class="logs-filters">
        <select bind:value={logSeverityFilter} class="log-severity-filter">
          <option value="all">All severities</option>
          <option value="error">Error+</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="trace">Trace</option>
        </select>
        <input
          type="text"
          bind:value={logTextFilter}
          placeholder="Filter logs by severity/text..."
          class="attribute-filter log-text-filter"
        />
      </div>

      {#if filteredLogs.length > 0}
        <div class="logs-list">
          {#each filteredLogs as log}
            {@const logDetail = logDetailsById[log.id] || null}
            {@const isLogDetailLoading = !!loadingLogDetailById[log.id]}
            {@const logDetailError = logDetailErrorsById[log.id] || null}
            <div
              class="log-item"
              class:is-selected={selectedLogId === log.id}
              data-log-id={log.id}
            >
              <div class="log-header">
                <span class="log-severity" data-level={severityBucket(log)}>
                  {log.severityText || 'UNSET'}
                </span>
                <span
                  class="log-timestamp"
                  title={formatTimestamp(
                    log.timeUnixNano || log.observedTimeUnixNano || '0',
                  )}
                >
                  {formatRelativeTime(
                    span.startTimeUnixNano,
                    log.timeUnixNano ||
                      log.observedTimeUnixNano ||
                      span.startTimeUnixNano,
                  )}
                </span>
              </div>
              <div class="log-body">
                {normalizeLogBody(log.body) || '(empty body)'}
              </div>
              <div class="log-actions">
                <button
                  class="log-action log-action-secondary"
                  onclick={() => {
                    if (openLogDetailIds.includes(log.id)) {
                      openLogDetailIds = openLogDetailIds.filter(
                        (id) => id !== log.id,
                      )
                      return
                    }
                    openLogDetailIds = [...openLogDetailIds, log.id]
                    onOpenLogDetail?.(log.id)
                  }}
                  title={openLogDetailIds.includes(log.id)
                    ? 'Hide full log details'
                    : 'Show full log details'}
                  disabled={isLogDetailLoading}
                >
                  <svg
                    class="log-action-icon"
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M1.5 2.25h9m-9 3.75h9m-9 3.75h9"
                      stroke="currentColor"
                      stroke-width="1.2"
                      stroke-linecap="round"
                    />
                  </svg>
                  {isLogDetailLoading
                    ? 'Loading...'
                    : openLogDetailIds.includes(log.id)
                      ? 'Hide details'
                      : 'Show details'}
                </button>
                {#if selectedLogId !== log.id}
                  <button
                    class="log-action"
                    onclick={() =>
                      onSelectLog?.(log.id, log.spanId || undefined)}
                    title={log.spanId === span.spanId
                      ? 'Select log record'
                      : 'Jump to log record'}
                  >
                    {log.spanId === span.spanId ? 'Select log' : 'Jump to log'}
                  </button>
                {/if}
              </div>
              {#if openLogDetailIds.includes(log.id) && (isLogDetailLoading || logDetailError || logDetail)}
                <div class="log-detail-panel">
                  {#if isLogDetailLoading}
                    <div class="no-attributes">Loading full log detail...</div>
                  {:else if logDetailError}
                    <div class="log-detail-error">{logDetailError}</div>
                  {:else}
                    {#if logDetail && Object.keys(logDetail.attributes).length > 0}
                      <div class="log-detail-group">
                        <div class="log-detail-heading">Attributes</div>
                        <div class="attributes">
                          {#each Object.entries(logDetail.attributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                            <AttributeItem
                              attrKey={key}
                              {value}
                              {onFullscreen}
                            />
                          {/each}
                        </div>
                      </div>
                    {/if}

                    {#if logDetail && Object.keys(logDetail.resource).length > 0}
                      <div class="log-detail-group">
                        <div class="log-detail-heading">Resource</div>
                        <div class="attributes">
                          {#each Object.entries(logDetail.resource).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                            <AttributeItem
                              attrKey={key}
                              {value}
                              {onFullscreen}
                            />
                          {/each}
                        </div>
                      </div>
                    {/if}

                    {#if logDetail && (logDetail.scopeName || logDetail.scopeVersion || Object.keys(logDetail.scopeAttributes).length > 0)}
                      <div class="log-detail-group">
                        <div class="log-detail-heading">Scope</div>
                        {#if logDetail.scopeName}
                          <div class="detail-row detail-row-compact">
                            <span class="label">Name:</span>
                            <span class="value">{logDetail.scopeName}</span>
                          </div>
                        {/if}
                        {#if logDetail.scopeVersion}
                          <div class="detail-row detail-row-compact">
                            <span class="label">Version:</span>
                            <span class="value">{logDetail.scopeVersion}</span>
                          </div>
                        {/if}
                        {#if Object.keys(logDetail.scopeAttributes).length > 0}
                          <div class="attributes">
                            {#each Object.entries(logDetail.scopeAttributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                              <AttributeItem
                                attrKey={key}
                                {value}
                                {onFullscreen}
                              />
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="no-attributes">No logs match the current filters.</div>
      {/if}
    {/if}
  {/if}

  <!-- Attributes -->
  {#if allAttributes.length > 0}
    <div class="section-divider"></div>
    <div class="section-header">
      <button
        class="section-toggle"
        onclick={() => (attributesCollapsed = !attributesCollapsed)}
        aria-expanded={!attributesCollapsed}
        title={attributesCollapsed
          ? 'Expand attributes'
          : 'Collapse attributes'}
      >
        <ChevronIcon expanded={!attributesCollapsed} />
        <h4 class="section-title">
          Attributes
          {#if attributeFilter.trim()}
            ({filteredAttributes.length} of {allAttributes.length})
          {:else}
            ({allAttributes.length})
          {/if}
        </h4>
      </button>
      {#if !attributesCollapsed}
        <input
          id="attribute-filter"
          type="text"
          bind:value={attributeFilter}
          placeholder="Filter attributes..."
          class="attribute-filter"
        />
      {/if}
    </div>
    {#if !attributesCollapsed}
      {#if filteredAttributes.length > 0}
        <div class="attributes">
          {#each filteredAttributes as [key, value]}
            <AttributeItem
              attrKey={key}
              {value}
              {onFullscreen}
              highlightKey={keyMatchesSearch(key)}
              highlightValue={valueMatchesSearch(value)}
              highlightQuery={searchQuery}
            />
          {/each}
        </div>
      {:else}
        <div class="no-attributes">No attributes match the filter.</div>
      {/if}
    {/if}
  {/if}

  <!-- Resource -->
  {#if allResourceEntries.length > 0}
    <div class="section-divider"></div>
    <div class="section-header">
      <button
        class="section-toggle"
        onclick={() => (resourceCollapsed = !resourceCollapsed)}
        aria-expanded={!resourceCollapsed}
        title={resourceCollapsed ? 'Expand resource' : 'Collapse resource'}
      >
        <ChevronIcon expanded={!resourceCollapsed} />
        <h4 class="section-title">
          Resource
          {#if resourceFilter.trim()}
            ({filteredResource.length} of {allResourceEntries.length})
          {:else}
            ({allResourceEntries.length})
          {/if}
        </h4>
      </button>
      {#if !resourceCollapsed}
        <input
          type="text"
          bind:value={resourceFilter}
          placeholder="Filter resource..."
          class="attribute-filter"
        />
      {/if}
    </div>
    {#if !resourceCollapsed}
      {#if filteredResource.length > 0}
        <div class="attributes">
          {#each filteredResource as [key, value]}
            <AttributeItem
              attrKey={key}
              {value}
              {onFullscreen}
              highlightKey={keyMatchesSearch(key)}
              highlightValue={valueMatchesSearch(value)}
              highlightQuery={searchQuery}
            />
          {/each}
        </div>
      {:else}
        <div class="no-attributes">
          No resource attributes match the filter.
        </div>
      {/if}
    {/if}
  {/if}

  <!-- Scope -->
  {#if hasScope}
    <div class="section-divider"></div>
    <div class="section-header">
      <button
        class="section-toggle"
        onclick={() => (scopeCollapsed = !scopeCollapsed)}
        aria-expanded={!scopeCollapsed}
        title={scopeCollapsed ? 'Expand scope' : 'Collapse scope'}
      >
        <ChevronIcon expanded={!scopeCollapsed} />
        <h4 class="section-title">
          Scope
          {#if allScopeEntries.length > 0}
            {#if scopeFilter.trim()}
              ({filteredScope.length} of {allScopeEntries.length} attrs)
            {:else}
              ({allScopeEntries.length} attrs)
            {/if}
          {/if}
        </h4>
      </button>
      {#if !scopeCollapsed && allScopeEntries.length > 0}
        <input
          type="text"
          bind:value={scopeFilter}
          placeholder="Filter scope attrs..."
          class="attribute-filter"
        />
      {/if}
    </div>
    {#if !scopeCollapsed}
      {#if span.scopeName}
        <div class="detail-row">
          <span class="label">Name:</span>
          <span
            class="value"
            class:search-match={textMatchesSearch(span.scopeName)}
            >{span.scopeName}</span
          >
        </div>
      {/if}
      {#if span.scopeVersion}
        <div class="detail-row">
          <span class="label">Version:</span>
          <span
            class="value"
            class:search-match={textMatchesSearch(span.scopeVersion)}
            >{span.scopeVersion}</span
          >
        </div>
      {/if}
      {#if allScopeEntries.length > 0}
        {#if filteredScope.length > 0}
          <div class="attributes">
            {#each filteredScope as [key, value]}
              <AttributeItem
                attrKey={key}
                {value}
                {onFullscreen}
                highlightKey={keyMatchesSearch(key)}
                highlightValue={valueMatchesSearch(value)}
                highlightQuery={searchQuery}
              />
            {/each}
          </div>
        {:else}
          <div class="no-attributes">No scope attributes match the filter.</div>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .span-details {
    font-size: 0.875rem;
    overflow-y: auto;
  }

  .detail-row {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border-light);
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.4rem;
  }

  .detail-row .label {
    font-weight: 600;
    color: var(--text-secondary);
  }

  .detail-row .value {
    color: var(--text-primary);
    word-break: break-all;
  }

  .status-error {
    color: var(--error-text);
    font-weight: 600;
  }

  .status-ok {
    color: var(--ok-text);
    font-weight: 600;
  }

  .parent-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: all 0.15s ease;
  }

  .parent-link:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  .mono {
    font-family: monospace;
  }

  .section-divider {
    border-top: 2px solid var(--border);
    margin: 1.5rem 0 1rem 0;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .section-header .section-title {
    margin: 0;
    flex: 1;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .section-toggle:hover .section-title {
    color: var(--accent, var(--text-primary));
  }

  .section-toggle .section-title {
    margin: 0;
    flex: 1;
  }

  .attribute-filter {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    width: 200px;
    transition: all 0.15s ease;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .attribute-filter:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-ring);
  }

  .attribute-filter::placeholder {
    color: var(--text-muted);
  }

  .event-item {
    padding: 0.75rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid var(--accent);
    transition: all 0.3s ease;
    scroll-margin-top: 20px;
  }

  .event-item.highlighted {
    background: var(--highlight-bg);
    border-left-color: var(--event-color);
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
  }

  .event-item.search-match {
    border-left-color: var(--highlight-border);
    box-shadow: inset 2px 0 0 var(--highlight-border);
  }

  .value.search-match,
  .parent-link.search-match {
    background: var(--highlight-bg);
    border-radius: 3px;
    padding: 0.05rem 0.2rem;
  }

  .event-name-segment.is-match {
    background: var(--highlight-bg-hover);
    border-radius: 2px;
    box-shadow: inset 0 -1px 0 var(--highlight-border);
    padding: 0;
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    gap: 1rem;
  }

  .event-name {
    font-weight: 600;
    color: var(--accent);
    font-size: 0.875rem;
    flex: 1;
  }

  .event-timestamp {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
    cursor: help;
  }

  .event-attributes {
    margin-left: 0.5rem;
  }

  .link-item {
    padding: 0.75rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid var(--link-accent);
  }

  .link-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .link-field {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .link-label {
    font-weight: 600;
    color: var(--text-secondary);
    min-width: 70px;
  }

  .link-value {
    color: var(--text-primary);
    word-break: break-all;
  }

  .link-anchor {
    color: var(--accent);
    text-decoration: none;
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .link-anchor:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  .link-anchor:visited {
    color: var(--link-visited);
  }

  .link-attributes {
    margin-top: 0.5rem;
    margin-left: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .attributes {
    background: var(--bg-surface-hover);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
  }

  .no-attributes {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
  }

  .logs-section-header {
    align-items: center;
  }

  .logs-scope-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .logs-filters {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .log-severity-filter {
    width: 140px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--text-primary);
    font-size: 0.75rem;
    padding: 0.375rem 0.5rem;
  }

  .log-text-filter {
    width: auto;
    flex: 1;
  }

  .logs-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .log-item {
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: 6px;
    padding: 0.6rem;
    background: var(--bg-surface-hover);
  }

  .log-item.is-selected {
    border-color: var(--accent);
    border-left-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-ring);
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .log-severity {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--text-secondary);
  }

  .log-severity[data-level='error'] {
    color: var(--error-text);
  }

  .log-severity[data-level='warn'] {
    color: #b26b00;
  }

  .log-severity[data-level='info'] {
    color: var(--accent);
  }

  .log-timestamp {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .log-body {
    font-size: 0.8125rem;
    color: var(--text-primary);
    word-break: break-word;
    margin-bottom: 0.45rem;
  }

  .log-actions {
    display: flex;
    gap: 0.45rem;
  }

  .log-action {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 0.25rem 0.45rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .log-action:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .log-action-secondary {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .log-action:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .log-detail-panel {
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px dashed var(--border);
    display: grid;
    gap: 0.6rem;
  }

  .log-action-icon {
    flex-shrink: 0;
  }

  .log-detail-group {
    display: grid;
    gap: 0.35rem;
  }

  .log-detail-heading {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .detail-row-compact {
    border-bottom: none;
    padding: 0.05rem 0;
    grid-template-columns: 64px 1fr;
  }

  .log-detail-error {
    color: var(--error-text);
    font-size: 0.75rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--error-text) 35%, var(--border));
    border-radius: 4px;
    background: color-mix(in srgb, var(--error-bg) 65%, transparent);
  }
</style>
