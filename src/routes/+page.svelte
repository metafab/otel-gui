<script lang="ts">
  import { traceStore } from "$lib/stores/traces.svelte";
  import { getServiceColor } from "$lib/utils/colors";

  // Start polling for traces
  traceStore.startPolling();

  // Reactive state from store
  const traces = $derived(traceStore.traces);
  const error = $derived(traceStore.error);
  const isLoading = $derived(traceStore.isLoading);

  function handleRowClick(traceId: string) {
    window.location.href = `/trace/${traceId}`;
  }

  async function handleClearAll() {
    if (confirm("Clear all traces? This cannot be undone.")) {
      await traceStore.clearAllTraces();
    }
  }
</script>

<div class="container">
  <header>
    <h1>OpenTelemetry Traces</h1>
    <div class="actions">
      <button
        onclick={handleClearAll}
        disabled={isLoading || traces.length === 0}
      >
        Clear All
      </button>
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if traces.length === 0}
    <div class="empty">
      <p>No traces received yet.</p>
      <p class="hint">
        Send OTLP traces to <code>http://localhost:4318/v1/traces</code>
      </p>
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Operation</th>
          <th>Duration</th>
          <th>Spans</th>
          <th>Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each traces as trace (trace.traceId)}
          <tr
            onclick={() => handleRowClick(trace.traceId)}
            class:error={trace.hasError}
          >
            <td>
              <span
                class="service-badge"
                style="--color: {getServiceColor(trace.serviceName)}"
              >
                {trace.serviceName}
              </span>
            </td>
            <td class="operation">{trace.rootSpanName}</td>
            <td class="duration">{trace.durationMs.toFixed(2)}ms</td>
            <td class="span-count">{trace.spanCount}</td>
            <td class="timestamp"
              >{new Date(trace.startTime).toLocaleTimeString()}</td
            >
            <td class="status">
              {#if trace.hasError}
                <span class="error-badge">ERROR</span>
              {:else}
                <span class="ok-badge">OK</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
  }

  .actions button {
    padding: 0.5rem 1rem;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .actions button:hover:not(:disabled) {
    background: #d32f2f;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    padding: 1rem;
    background: #ffebee;
    border: 1px solid #f44336;
    border-radius: 4px;
    color: #c62828;
    margin-bottom: 1rem;
  }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: #666;
  }

  .empty p {
    margin: 0.5rem 0;
  }

  .empty code {
    background: #f5f5f5;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.875rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  thead {
    background: #f5f5f5;
  }

  th {
    text-align: left;
    padding: 0.75rem 1rem;
    font-weight: 600;
    font-size: 0.875rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  tbody tr {
    border-top: 1px solid #e0e0e0;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: #f9f9f9;
  }

  tbody tr.error {
    background: #fff3f3;
  }

  tbody tr.error:hover {
    background: #ffebeb;
  }

  td {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }

  .service-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: var(--color);
    color: white;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .operation {
    font-family: monospace;
    font-weight: 500;
  }

  .duration {
    font-family: monospace;
    color: #1976d2;
    font-weight: 500;
  }

  .span-count {
    color: #666;
  }

  .timestamp {
    color: #999;
    font-size: 0.8125rem;
  }

  .status {
    text-align: center;
  }

  .error-badge,
  .ok-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .error-badge {
    background: #ffebee;
    color: #c62828;
  }

  .ok-badge {
    background: #e8f5e9;
    color: #2e7d32;
  }
</style>
