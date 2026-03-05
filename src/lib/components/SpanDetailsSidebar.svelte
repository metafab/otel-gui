<script lang="ts">
  import type { StoredSpan } from '$lib/types'
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
    /** Index of the highlighted event (from clicking a WaterfallRow event dot). */
    highlightedEventIndex?: number | null
    /** Global span search query from trace page. */
    searchQuery?: string
  }

  let {
    span,
    onSelectSpan,
    onFullscreen,
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

  function eventMatchesSearch(event: StoredSpan['events'][number]): boolean {
    if (textMatchesSearch(event.name)) return true
    for (const [key, value] of Object.entries(event.attributes)) {
      if (keyValueMatchesSearch(key, value)) return true
    }
    return false
  }

  // Per-section filter state (local, resets when span changes)
  let attributeFilter = $state('')
  let resourceFilter = $state('')
  let scopeFilter = $state('')
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
    resourceCollapsed = true
    scopeCollapsed = true
  })

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
            <div
              class="event-name"
              class:search-match={textMatchesSearch(event.name)}
            >
              {event.name}
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
              href="/trace/{link.traceId}"
              class="link-value mono link-anchor"
              title="Open linked trace"
            >
              {link.traceId}
            </a>
          </div>
          <div class="link-field">
            <span class="link-label">Span ID:</span>
            <a
              href="/trace/{link.traceId}?spanId={link.spanId}"
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
  .event-name.search-match,
  .parent-link.search-match {
    background: var(--highlight-bg);
    border-radius: 3px;
    padding: 0.05rem 0.2rem;
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
</style>
