<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { traceStore } from "$lib/stores/traces.svelte";
  import {
    buildSpanTree,
    flattenSpanTree,
    spanKindLabel,
    statusLabel,
  } from "$lib/utils/spans";
  import {
    formatDuration,
    formatTimestamp,
    formatRelativeTime,
  } from "$lib/utils/time";
  import WaterfallRow from "$lib/components/WaterfallRow.svelte";
  import type { StoredTrace, SpanTreeNode } from "$lib/types";

  // Get trace ID from URL
  const traceId = $derived($page.params.traceId);
  const spanIdFromUrl = $derived($page.url.searchParams.get("spanId"));

  // Local state
  let trace = $state<StoredTrace | null>(null);
  let spanTree = $state<SpanTreeNode[]>([]);
  let selectedSpanId = $state<string | null>(null);
  let selectedEventIndex = $state<number | null>(null);
  let isLoading = $state<boolean>(true);
  let error = $state<string | null>(null);

  // Derived: trace duration for waterfall calculation
  const traceDurationNs = $derived(
    trace
      ? BigInt(trace.endTimeUnixNano) - BigInt(trace.startTimeUnixNano)
      : 0n,
  );
  const traceDuration = $derived(
    trace ? formatDuration(trace.startTimeUnixNano, trace.endTimeUnixNano) : "",
  );

  // Load trace data on mount
  onMount(async () => {
    await loadTrace();
  });

  // Reload trace when URL changes (for hyperlink navigation)
  $effect(() => {
    // Watch for changes in traceId or spanIdFromUrl
    if (traceId) {
      loadTrace();
    }
  });

  async function loadTrace() {
    if (!traceId) {
      error = "No trace ID provided";
      isLoading = false;
      return;
    }
    isLoading = true;
    error = null;
    try {
      const data = await traceStore.fetchTrace(traceId);
      if (data) {
        // API returns spans as Record, convert to Map for type compatibility
        const spansMap = new Map<string, any>();
        const spansArray = [];
        for (const [id, span] of Object.entries(data.spans)) {
          spansMap.set(id, span);
          spansArray.push(span);
        }
        trace = { ...data, spans: spansMap };
        // Build tree and flatten for rendering
        const tree = buildSpanTree(spansArray);
        spanTree = flattenSpanTree(tree);

        // Auto-select span from URL query parameter if present, otherwise reset selection
        if (spanIdFromUrl && spansMap.has(spanIdFromUrl)) {
          selectedSpanId = spanIdFromUrl;
        } else {
          selectedSpanId = null;
        }
      } else {
        error = "Trace not found";
      }
    } catch (err) {
      error =
        err instanceof Error ? err.message : "Unknown error loading trace";
    } finally {
      isLoading = false;
    }
  }

  function handleSpanSelect(spanId: string) {
    selectedSpanId = spanId;
    selectedEventIndex = null; // Clear event selection when selecting a different span
    // Update URL to include selected span (for bookmarking/sharing)
    const url = new URL(window.location.href);
    url.searchParams.set("spanId", spanId);
    window.history.replaceState({}, "", url);
  }

  function handleEventClick(spanId: string, eventIndex: number) {
    // Select the span if not already selected
    if (selectedSpanId !== spanId) {
      selectedSpanId = spanId;
    }
    selectedEventIndex = eventIndex;

    // Scroll to the event in the sidebar
    setTimeout(() => {
      const eventElement = document.getElementById(`event-${eventIndex}`);
      if (eventElement) {
        eventElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  }

  function handleBack() {
    window.location.href = "/";
  }
</script>

<div class="trace-detail">
  <header class="header">
    <button class="back-button" onclick={handleBack}>← Back to Traces</button>
  </header>

  {#if isLoading}
    <div class="loading">Loading trace...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if trace}
    <div class="trace-container">
      <!-- Trace Identification Section -->
      <section class="trace-identification">
        <h2>Trace {trace.traceId}</h2>
        <div class="trace-meta">
          <span class="service">{trace.serviceName}</span>
          <span class="separator">•</span>
          <span class="operation">{trace.rootSpanName}</span>
          <span class="separator">•</span>
          <span class="spans">{trace.spanCount} spans</span>
          {#if trace.hasError}
            <span class="separator">•</span>
            <span class="error-badge">ERROR</span>
          {/if}
        </div>
        <div class="trace-timestamps">
          <div class="timestamp-item">
            <span class="timestamp-label">Started:</span>
            <span class="timestamp-value"
              >{formatTimestamp(trace.startTimeUnixNano)}</span
            >
          </div>
          <div class="timestamp-item">
            <span class="timestamp-label">Ended:</span>
            <span class="timestamp-value"
              >{formatTimestamp(trace.endTimeUnixNano)}</span
            >
          </div>
          <div class="timestamp-item">
            <span class="timestamp-label">Duration:</span>
            <span class="timestamp-value">{traceDuration}</span>
          </div>
        </div>
      </section>

      <!-- Main Content Grid -->
      <div class="content-grid">
        <!-- Waterfall Section (Left) -->
        <section class="waterfall-section">
          <div class="waterfall-header">
            <h3>Trace Timeline</h3>
            <div class="trace-duration">
              Total: <strong>{traceDuration}</strong>
            </div>
          </div>
          <div class="waterfall">
            <!-- Time ruler -->
            <div class="time-ruler">
              <div class="ruler-labels">
                <span>Span Name</span>
              </div>
              <div class="ruler-timeline">
                <span class="ruler-mark">0ms</span>
                <span class="ruler-mark">25%</span>
                <span class="ruler-mark">50%</span>
                <span class="ruler-mark">75%</span>
                <span class="ruler-mark">{traceDuration}</span>
              </div>
            </div>

            <!-- Waterfall rows -->
            {#each spanTree as node (node.span.spanId)}
              <WaterfallRow
                span={node.span}
                depth={node.depth}
                traceStartNano={trace.startTimeUnixNano}
                {traceDurationNs}
                isSelected={node.span.spanId === selectedSpanId}
                onSelect={() => handleSpanSelect(node.span.spanId)}
                onEventClick={(eventIndex) =>
                  handleEventClick(node.span.spanId, eventIndex)}
              />
            {/each}
          </div>
        </section>

        <!-- Span Details Sidebar (Right) -->
        <section class="sidebar-section">
          {#if selectedSpanId && trace.spans.get(selectedSpanId)}
            {@const selectedSpan = trace.spans.get(selectedSpanId)}
            {#if selectedSpan}
              <h3>Span Details</h3>
              <div class="span-details">
                <div class="detail-row">
                  <span class="label">Name:</span>
                  <span class="value">{selectedSpan.name}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Started:</span>
                  <span class="value"
                    >{formatTimestamp(selectedSpan.startTimeUnixNano)}</span
                  >
                </div>
                <div class="detail-row">
                  <span class="label">Ended:</span>
                  <span class="value"
                    >{formatTimestamp(selectedSpan.endTimeUnixNano)}</span
                  >
                </div>
                <div class="detail-row">
                  <span class="label">Duration:</span>
                  <span class="value">
                    {formatDuration(
                      selectedSpan.startTimeUnixNano,
                      selectedSpan.endTimeUnixNano,
                    )}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="label">Kind:</span>
                  <span class="value">{spanKindLabel(selectedSpan.kind)}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Status:</span>
                  <span
                    class="value"
                    class:status-error={selectedSpan.status.code === 2}
                    class:status-ok={selectedSpan.status.code === 1}
                  >
                    {statusLabel(selectedSpan.status.code)}
                    {#if selectedSpan.status.message}
                      - {selectedSpan.status.message}
                    {/if}
                  </span>
                </div>
                <div class="detail-row">
                  <span class="label">Span ID:</span>
                  <span class="value mono">{selectedSpan.spanId}</span>
                </div>
                {#if selectedSpan.parentSpanId}
                  <div class="detail-row">
                    <span class="label">Parent ID:</span>
                    <button
                      class="value mono parent-link"
                      onclick={() =>
                        handleSpanSelect(selectedSpan.parentSpanId)}
                      title="Jump to parent span"
                    >
                      {selectedSpan.parentSpanId}
                    </button>
                  </div>
                {/if}
                <div class="detail-row">
                  <span class="label">Service:</span>
                  <span class="value"
                    >{selectedSpan.resource["service.name"] || "unknown"}</span
                  >
                </div>

                {#if selectedSpan.events.length > 0}
                  <div class="section-divider"></div>
                  <h4 class="section-title">
                    Events ({selectedSpan.events.length})
                  </h4>
                  {#each selectedSpan.events as event, index}
                    <div
                      class="event-item"
                      id="event-{index}"
                      class:highlighted={selectedEventIndex === index}
                    >
                      <div class="event-header">
                        <div class="event-name">{event.name}</div>
                        <div
                          class="event-timestamp"
                          title={formatTimestamp(event.timeUnixNano)}
                        >
                          {formatRelativeTime(
                            selectedSpan.startTimeUnixNano,
                            event.timeUnixNano,
                          )}
                        </div>
                      </div>
                      {#if Object.keys(event.attributes).length > 0}
                        <div class="event-attributes">
                          {#each Object.entries(event.attributes) as [key, value]}
                            <div class="attribute-row">
                              <span class="attr-key">{key}:</span>
                              <span class="attr-value"
                                >{JSON.stringify(value)}</span
                              >
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                {/if}

                {#if selectedSpan.links.length > 0}
                  <div class="section-divider"></div>
                  <h4 class="section-title">
                    Links ({selectedSpan.links.length})
                  </h4>
                  {#each selectedSpan.links as link}
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
                          {#each Object.entries(link.attributes) as [key, value]}
                            <div class="attribute-row">
                              <span class="attr-key">{key}:</span>
                              <span class="attr-value"
                                >{JSON.stringify(value)}</span
                              >
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                {/if}

                {#if Object.keys(selectedSpan.attributes).length > 0}
                  <div class="section-divider"></div>
                  <h4 class="section-title">
                    Attributes ({Object.keys(selectedSpan.attributes).length})
                  </h4>
                  <div class="attributes">
                    {#each Object.entries(selectedSpan.attributes) as [key, value]}
                      <div class="attribute-row">
                        <span class="attr-key">{key}:</span>
                        <span class="attr-value">{JSON.stringify(value)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          {:else}
            <div class="no-selection">
              <p>Select a span to view details</p>
            </div>
          {/if}
        </section>
      </div>
    </div>
  {/if}
</div>

<style>
  .trace-detail {
    min-height: 100vh;
    background: #fafafa;
  }

  .header {
    background: white;
    border-bottom: 1px solid #e0e0e0;
    padding: 1rem 2rem;
  }

  .back-button {
    padding: 0.5rem 1rem;
    background: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .back-button:hover {
    background: #f5f5f5;
  }

  .loading,
  .error {
    text-align: center;
    padding: 2rem;
    color: #666;
  }

  .error {
    color: #c62828;
  }

  .trace-container {
    max-width: 1600px;
    margin: 0 auto;
    padding: 2rem;
  }

  .trace-identification {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .trace-identification h2 {
    font-size: 1.25rem;
    margin: 0 0 0.75rem 0;
    font-family: monospace;
  }

  .trace-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #666;
  }

  .trace-timestamps {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #f0f0f0;
  }

  .timestamp-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .timestamp-label {
    font-size: 0.75rem;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .timestamp-value {
    font-size: 0.875rem;
    color: #333;
    font-family: monospace;
  }

  .separator {
    color: #ccc;
  }

  .service {
    font-weight: 600;
    color: #1976d2;
  }

  .operation {
    font-family: monospace;
  }

  .error-badge {
    background: #ffebee;
    color: #c62828;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 400px;
    gap: 1.5rem;
  }

  .waterfall-section,
  .sidebar-section {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .waterfall-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .waterfall-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .trace-duration {
    font-size: 0.875rem;
    color: #666;
  }

  .trace-duration strong {
    color: #1976d2;
    font-family: monospace;
  }

  .sidebar-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .waterfall {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
  }

  .time-ruler {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    padding: 0.75rem 0.5rem;
    background: #fafafa;
    border-bottom: 2px solid #e0e0e0;
    font-size: 0.75rem;
    color: #666;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .ruler-labels {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ruler-timeline {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0.5rem;
    font-family: monospace;
  }

  .ruler-mark {
    font-size: 0.6875rem;
    color: #999;
  }

  .no-selection {
    text-align: center;
    padding: 3rem 1rem;
    color: #999;
  }

  .span-details {
    font-size: 0.875rem;
    max-height: 700px;
    overflow-y: auto;
  }

  .detail-row {
    padding: 0.75rem 0;
    border-bottom: 1px solid #f0f0f0;
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 0.75rem;
  }

  .detail-row .label {
    font-weight: 600;
    color: #666;
  }

  .detail-row .value {
    color: #333;
    word-break: break-all;
  }

  .status-error {
    color: #c62828;
    font-weight: 600;
  }

  .status-ok {
    color: #2e7d32;
    font-weight: 600;
  }

  .parent-link {
    background: none;
    border: none;
    color: #1976d2;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: all 0.15s ease;
  }

  .parent-link:hover {
    color: #1565c0;
    text-decoration: underline;
  }

  .mono {
    font-family: monospace;
  }

  .section-divider {
    border-top: 2px solid #e0e0e0;
    margin: 1.5rem 0 1rem 0;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .event-item {
    padding: 0.75rem;
    background: #f9f9f9;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid #1976d2;
    transition: all 0.3s ease;
    scroll-margin-top: 20px;
  }

  .event-item.highlighted {
    background: #fff3e0;
    border-left-color: #ff9800;
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
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
    color: #1976d2;
    font-size: 0.875rem;
    flex: 1;
  }

  .event-timestamp {
    font-family: monospace;
    font-size: 0.75rem;
    color: #666;
    white-space: nowrap;
    cursor: help;
  }

  .event-attributes {
    margin-left: 0.5rem;
  }

  .link-item {
    padding: 0.75rem;
    background: #f9f9f9;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid #9c27b0;
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
    color: #666;
    min-width: 70px;
  }

  .link-value {
    color: #333;
    word-break: break-all;
  }

  .link-anchor {
    color: #1976d2;
    text-decoration: none;
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .link-anchor:hover {
    color: #1565c0;
    text-decoration: underline;
  }

  .link-anchor:visited {
    color: #7b1fa2;
  }

  .link-attributes {
    margin-top: 0.5rem;
    margin-left: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #e0e0e0;
  }

  .attributes {
    background: #f9f9f9;
    padding: 0.75rem;
    border-radius: 4px;
  }

  .attribute-row {
    padding: 0.375rem 0;
    font-size: 0.8125rem;
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 0.5rem;
  }

  .attr-key {
    color: #1976d2;
    font-weight: 500;
    word-break: break-word;
  }

  .attr-value {
    color: #666;
    font-family: monospace;
    word-break: break-all;
  }
</style>
