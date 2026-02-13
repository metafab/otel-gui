<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { traceStore } from "$lib/stores/traces.svelte";
  import { buildSpanTree, flattenSpanTree } from "$lib/utils/spans";
  import type { StoredTrace, SpanTreeNode } from "$lib/types";

  // Get trace ID from URL
  const traceId = $derived($page.params.traceId);

  // Local state
  let trace = $state<StoredTrace | null>(null);
  let spanTree = $state<SpanTreeNode[]>([]);
  let selectedSpanId = $state<string | null>(null);
  let isLoading = $state<boolean>(true);
  let error = $state<string | null>(null);

  // Load trace data
  onMount(async () => {
    await loadTrace();
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
      </section>

      <!-- Main Content Grid -->
      <div class="content-grid">
        <!-- Waterfall Section (Left) -->
        <section class="waterfall-section">
          <h3>Trace Timeline</h3>
          <div class="waterfall">
            {#each spanTree as node (node.span.spanId)}
              <div
                class="waterfall-row"
                class:selected={node.span.spanId === selectedSpanId}
                onclick={() => handleSpanSelect(node.span.spanId)}
                onkeydown={(e) =>
                  e.key === "Enter" && handleSpanSelect(node.span.spanId)}
                role="button"
                tabindex="0"
                style="padding-left: {node.depth * 20}px"
              >
                <span class="span-name">{node.span.name}</span>
                <span class="span-service"
                  >{node.span.resource["service.name"] || "unknown"}</span
                >
              </div>
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
                  <span class="label">Span ID:</span>
                  <span class="value mono">{selectedSpan.spanId}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Service:</span>
                  <span class="value"
                    >{selectedSpan.resource["service.name"] || "unknown"}</span
                  >
                </div>
                {#if Object.keys(selectedSpan.attributes).length > 0}
                  <div class="attributes">
                    <h4>Attributes</h4>
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

  .waterfall-section h3,
  .sidebar-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .waterfall {
    max-height: 600px;
    overflow-y: auto;
  }

  .waterfall-row {
    padding: 0.5rem;
    border-left: 2px solid #e0e0e0;
    margin-bottom: 0.25rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .waterfall-row:hover {
    background: #f5f5f5;
  }

  .waterfall-row.selected {
    background: #e3f2fd;
    border-left-color: #1976d2;
  }

  .span-name {
    display: block;
    font-weight: 500;
    font-size: 0.875rem;
  }

  .span-service {
    display: block;
    font-size: 0.75rem;
    color: #999;
    margin-top: 0.25rem;
  }

  .no-selection {
    text-align: center;
    padding: 3rem 1rem;
    color: #999;
  }

  .span-details {
    font-size: 0.875rem;
  }

  .detail-row {
    padding: 0.5rem 0;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    gap: 0.5rem;
  }

  .detail-row .label {
    font-weight: 600;
    color: #666;
    min-width: 80px;
  }

  .detail-row .value {
    color: #333;
    word-break: break-all;
  }

  .mono {
    font-family: monospace;
  }

  .attributes {
    margin-top: 1rem;
  }

  .attributes h4 {
    font-size: 0.875rem;
    margin: 0 0 0.5rem 0;
    color: #666;
  }

  .attribute-row {
    padding: 0.25rem 0;
    font-size: 0.8125rem;
  }

  .attr-key {
    color: #1976d2;
    font-weight: 500;
  }

  .attr-value {
    color: #666;
    font-family: monospace;
  }
</style>
