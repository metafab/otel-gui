<script lang="ts">
  import { traceStore } from "$lib/stores/traces.svelte";
  import ServiceBadge from "$lib/components/ServiceBadge.svelte";

  // Connect to SSE stream for real-time trace updates
  traceStore.connectSSE();

  // Reactive state from store
  const traces = $derived(traceStore.traces);
  const error = $derived(traceStore.error);
  const isLoading = $derived(traceStore.isLoading);

  // Filter state
  let searchQuery = $state("");
  let selectedService = $state<string>("all");
  let showErrorsOnly = $state(false);
  let minDuration = $state<number | null>(null);
  let maxDuration = $state<number | null>(null);

  // Get unique services for filter dropdown
  const services = $derived(
    Array.from(new Set(traces.map((t) => t.serviceName))).sort(),
  );

  // Filtered traces
  const filteredTraces = $derived.by(() => {
    let result = traces;

    // Search filter (trace ID, operation name, or service)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.traceId.toLowerCase().includes(query) ||
          t.rootSpanName.toLowerCase().includes(query) ||
          t.serviceName.toLowerCase().includes(query),
      );
    }

    // Service filter
    if (selectedService !== "all") {
      result = result.filter((t) => t.serviceName === selectedService);
    }

    // Status filter
    if (showErrorsOnly) {
      result = result.filter((t) => t.hasError);
    }

    // Duration filter (with null checks)
    if (minDuration !== null && minDuration !== undefined) {
      const min = minDuration; // Capture non-null value
      result = result.filter((t) => t.durationMs >= min);
    }
    if (maxDuration !== null && maxDuration !== undefined) {
      const max = maxDuration; // Capture non-null value
      result = result.filter((t) => t.durationMs <= max);
    }

    return result;
  });

  function handleClearFilters() {
    searchQuery = "";
    selectedService = "all";
    showErrorsOnly = false;
    minDuration = null;
    maxDuration = null;
  }

  const hasActiveFilters = $derived(
    searchQuery.trim() !== "" ||
      selectedService !== "all" ||
      showErrorsOnly ||
      minDuration !== null ||
      maxDuration !== null,
  );

  function handleRowClick(traceId: string) {
    window.location.href = `/trace/${traceId}`;
  }

  async function handleClearAll() {
    if (confirm("Clear all traces? This cannot be undone.")) {
      await traceStore.clearAllTraces();
    }
  }
</script>

<svelte:head>
  <title>otel-gui – Traces</title>
</svelte:head>

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
    <!-- Filters Section -->
    <div class="filters">
      <div class="filter-row">
        <div class="filter-group search-group">
          <label for="search">Search</label>
          <input
            id="search"
            type="text"
            bind:value={searchQuery}
            placeholder="Search by trace ID, operation, or service..."
            class="search-input"
          />
        </div>

        <div class="filter-group">
          <label for="service">Service</label>
          <select
            id="service"
            bind:value={selectedService}
            class="filter-select"
          >
            <option value="all">All Services</option>
            {#each services as service}
              <option value={service}>{service}</option>
            {/each}
          </select>
        </div>

        <div class="filter-group">
          <span class="filter-label">Status</span>
          <label class="checkbox-label">
            <input
              id="errors-only"
              type="checkbox"
              bind:checked={showErrorsOnly}
            />
            <span>Errors Only</span>
          </label>
        </div>

        <div class="filter-group">
          <label for="minDuration">Min Duration (ms)</label>
          <input
            id="minDuration"
            type="number"
            bind:value={minDuration}
            placeholder="0"
            class="duration-input"
            min="0"
            step="0.1"
          />
        </div>

        <div class="filter-group">
          <label for="maxDuration">Max Duration (ms)</label>
          <input
            id="maxDuration"
            type="number"
            bind:value={maxDuration}
            placeholder="∞"
            class="duration-input"
            min="0"
            step="0.1"
          />
        </div>

        {#if hasActiveFilters}
          <button onclick={handleClearFilters} class="clear-filters-btn">
            Clear Filters
          </button>
        {/if}
      </div>

      <div class="filter-stats">
        Showing <strong>{filteredTraces.length}</strong> of
        <strong>{traces.length}</strong> traces
      </div>
    </div>

    {#if filteredTraces.length === 0}
      <div class="empty">
        <p>No traces match the current filters.</p>
        <button onclick={handleClearFilters} class="clear-filters-btn">
          Clear Filters
        </button>
      </div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Root Service</th>
            <th>Root Name</th>
            <th>Root Duration</th>
            <th>Spans</th>
            <th>Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredTraces as trace (trace.traceId)}
            <tr
              onclick={() => handleRowClick(trace.traceId)}
              class:error={trace.hasError}
            >
              <td><ServiceBadge serviceName={trace.serviceName} /></td>
              <td class="operation">{trace.rootSpanName}</td>
              <td class="duration">{trace.durationMs.toFixed(2)}ms</td>
              <td class="span-count">{trace.spanCount}</td>
              <td class="timestamp" title={trace.startTime}>
                {new Date(trace.startTime).toLocaleString()}
              </td>
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
    background: var(--error-border);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .actions button:hover:not(:disabled) {
    background: var(--error-text);
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    padding: 1rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 4px;
    color: var(--error-text);
    margin-bottom: 1rem;
  }

  /* Filter Controls */
  .filters {
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
  }

  .filter-row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-bottom: 1rem;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-width: 150px;
  }

  .search-group {
    flex: 2;
    min-width: 300px;
  }

  .filter-group label:not(.checkbox-label),
  .filter-group .filter-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .search-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    width: 100%;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .filter-select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    background: var(--input-bg);
    color: var(--text-primary);
    cursor: pointer;
  }

  .filter-select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    padding: 0.5rem 0;
  }

  .checkbox-label input[type="checkbox"] {
    cursor: pointer;
    width: 16px;
    height: 16px;
  }

  .duration-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    width: 120px;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .duration-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .clear-filters-btn {
    padding: 0.5rem 1rem;
    background: var(--bg-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    white-space: nowrap;
    align-self: flex-end;
    transition: background 0.15s ease;
  }

  .clear-filters-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .filter-stats {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .filter-stats strong {
    color: var(--accent);
    font-weight: 600;
  }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary);
  }

  .empty p {
    margin: 0.5rem 0;
  }

  .empty code {
    background: var(--bg-muted);
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.875rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-surface);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px var(--shadow);
  }

  thead {
    background: var(--bg-muted);
  }

  th {
    text-align: left;
    padding: 0.75rem 1rem;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  tbody tr {
    border-top: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: var(--bg-surface-hover);
  }

  tbody tr.error {
    background: var(--error-bg-row);
  }

  tbody tr.error:hover {
    background: var(--error-bg-row-hover);
  }

  td {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }

  .operation {
    font-family: monospace;
    font-weight: 500;
  }

  .duration {
    font-family: monospace;
    color: var(--accent);
    font-weight: 500;
  }

  .span-count {
    color: var(--text-secondary);
  }

  .timestamp {
    color: var(--text-muted);
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
    background: var(--error-bg);
    color: var(--error-text);
  }

  .ok-badge {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
</style>
