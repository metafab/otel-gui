<script lang="ts">
  interface Props {
    services: string[]
    searchQuery: string
    selectedService: string
    selectedSeverity: string
    filteredCount: number
    totalCount: number
    searchInputEl?: HTMLInputElement | null
  }

  let {
    services,
    searchQuery = $bindable(''),
    selectedService = $bindable('all'),
    selectedSeverity = $bindable('all'),
    filteredCount,
    totalCount,
    searchInputEl = $bindable(null),
  }: Props = $props()

  const hasActiveFilters = $derived(
    searchQuery.trim() !== '' ||
      selectedService !== 'all' ||
      selectedSeverity !== 'all',
  )

  function handleClear() {
    searchQuery = ''
    selectedService = 'all'
    selectedSeverity = 'all'
  }
</script>

<div class="filters">
  <div class="filter-row">
    <div class="filter-group search-group">
      <label for="log-search">Search</label>
      <input
        id="log-search"
        type="text"
        bind:value={searchQuery}
        bind:this={searchInputEl}
        placeholder="Search logs (service, severity, body, trace ID...)"
        class="search-input"
      />
    </div>

    <div class="filter-group">
      <label for="log-service">Service</label>
      <select
        id="log-service"
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
      <label for="log-severity">Severity</label>
      <select
        id="log-severity"
        bind:value={selectedSeverity}
        class="filter-select"
      >
        <option value="all">All Severities</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
      </select>
    </div>

    {#if hasActiveFilters}
      <button onclick={handleClear} class="clear-filters-btn">
        Clear Filters
      </button>
    {/if}
  </div>

  <div class="filter-stats">
    Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> logs
  </div>
</div>

<style>
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

  .filter-group label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .search-input,
  .filter-select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    background: var(--input-bg);
    color: var(--text-primary);
    width: 100%;
  }

  .search-input:focus,
  .filter-select:focus {
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
</style>
