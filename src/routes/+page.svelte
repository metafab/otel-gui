<script lang="ts">
  import { traceStore } from "$lib/stores/traces.svelte";
  import ServiceBadge from "$lib/components/ServiceBadge.svelte";
  import ServiceMap from "$lib/components/ServiceMap.svelte";
  import { isInputFocused, isMac } from "$lib/utils/keyboard";
  import KeyboardShortcutsHelp from "$lib/components/KeyboardShortcutsHelp.svelte";
  import type { ServiceMapData } from "$lib/types";

  // Connect to SSE stream for real-time trace updates
  traceStore.connectSSE();

  // Reactive state from store
  const traces = $derived(traceStore.traces);
  const error = $derived(traceStore.error);
  const isLoading = $derived(traceStore.isLoading);

  // Tab navigation
  let activeTab = $state<"traces" | "map">("traces");

  // Service map state
  let serviceMapData = $state<ServiceMapData | null>(null);
  let serviceMapLoading = $state(false);
  let serviceMapError = $state<string | null>(null);

  async function fetchServiceMap() {
    serviceMapLoading = true;
    serviceMapError = null;
    try {
      const res = await fetch("/api/service-map");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      serviceMapData = await res.json();
    } catch (e) {
      serviceMapError = e instanceof Error ? e.message : String(e);
    } finally {
      serviceMapLoading = false;
    }
  }

  // Re-fetch service map when switching to map tab or when traces update
  $effect(() => {
    if (activeTab === "map") {
      // Re-fetch whenever trace count changes so the map stays current
      void traceStore.traces.length; // reactive dependency
      fetchServiceMap();
    }
  });

  function handleMapNodeSelect(serviceName: string) {
    selectedService = serviceName;
    activeTab = "traces";
  }

  // Filter state
  let searchQuery = $state("");
  let selectedService = $state<string>("all");
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let showShortcuts = $state(false);
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

  function handleGlobalKeydown(e: KeyboardEvent) {
    // '/' focuses search (only when not in an input)
    if (e.key === "/" && !isInputFocused()) {
      e.preventDefault();
      searchInputEl?.focus();
      return;
    }
    // Alt/Option+Delete: Clear All.
    // On macOS the ⌫ key fires e.key === "Backspace"; "Delete" is fn+⌫ (forward delete).
    // Check both so the shortcut works on all platforms.
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !isInputFocused()
    ) {
      e.preventDefault();
      handleClearAll();
      return;
    }
    // Escape: clear search if input focused
    if (e.key === "Escape" && isInputFocused()) {
      searchQuery = "";
      searchInputEl?.blur();
      return;
    }
    // '?': toggle shortcuts help
    if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      showShortcuts = !showShortcuts;
    }
    // 'm': toggle between Traces and Map tabs
    if (e.key === "m" && !isInputFocused()) {
      e.preventDefault();
      activeTab = activeTab === "traces" ? "map" : "traces";
    }
  }
</script>

<svelte:head>
  <title>otel-gui – {activeTab === "map" ? "Service Map" : "Traces"}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="container">
  <header>
    <div class="tab-bar" role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === "traces"}
        class="tab-btn"
        class:active={activeTab === "traces"}
        onclick={() => (activeTab = "traces")}
        >Traces {#if traces.length > 0}<span class="tab-count"
            >{traces.length}</span
          >{/if}</button
      >
      <button
        role="tab"
        aria-selected={activeTab === "map"}
        class="tab-btn"
        class:active={activeTab === "map"}
        onclick={() => (activeTab = "map")}>Service Map</button
      >
    </div>
    <div class="actions">
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
      <button
        onclick={handleClearAll}
        disabled={isLoading || traces.length === 0}
      >
        Clear All
      </button>
    </div>
  </header>

  {#if activeTab === "traces"}
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
              bind:this={searchInputEl}
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
  {:else}
    <!-- Service Map tab -->
    <div class="map-content">
      {#if serviceMapLoading}
        <div class="map-status">Loading service map…</div>
      {:else if serviceMapError}
        <div class="error">{serviceMapError}</div>
      {:else if serviceMapData}
        <ServiceMap
          data={serviceMapData}
          onSelectService={handleMapNodeSelect}
        />
      {/if}
    </div>
  {/if}
</div>

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      { keys: ["/"], description: "Focus search" },
      {
        keys: ["Esc"],
        description:
          "Dismiss search (when search focused) / Go back to trace list",
      },
      {
        keys: [isMac ? "Option+⌫" : "Alt+Delete"],
        description: "Clear all traces (opens confirm dialog)",
      },
      { keys: ["m"], description: "Toggle Traces / Service Map tab" },
      { keys: ["?"], description: "Toggle keyboard shortcuts help" },
    ]}
    onclose={() => (showShortcuts = false)}
  />
{/if}

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

  /* Tab navigation */
  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    align-self: flex-end;
  }

  .tab-btn {
    padding: 0.5rem 1.25rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-secondary);
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--text-secondary);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
  }

  .tab-btn.active .tab-count {
    background: var(--accent-ring);
    color: var(--accent);
  }

  /* Service map container */
  .map-content {
    padding: 0;
  }

  .map-status {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .actions button:not(.shortcut-help-btn) {
    padding: 0.5rem 1rem;
    background: var(--error-border);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .actions button:not(.shortcut-help-btn):hover:not(:disabled) {
    background: var(--error-text);
  }

  .actions button:not(.shortcut-help-btn):disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .shortcut-help-btn {
    padding: 0.5rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .shortcut-help-btn:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
    color: var(--accent);
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
