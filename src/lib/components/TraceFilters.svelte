<script lang="ts">
  interface Props {
    /** Available service names for the dropdown. */
    services: string[]
    /** Bound: text search query. */
    searchQuery: string
    /** Bound: selected service name, or "all". */
    selectedService: string
    /** Bound: show only traces with errors. */
    showErrorsOnly: boolean
    /** Bound: minimum duration filter in ms. */
    minDuration: number | null
    /** Bound: maximum duration filter in ms. */
    maxDuration: number | null
    /** Number of traces passing all filters. */
    filteredCount: number
    /** Total number of traces. */
    totalCount: number
    /** Ref to the search input for programmatic focus. */
    searchInputEl?: HTMLInputElement | null
  }

  let {
    services,
    searchQuery = $bindable(''),
    selectedService = $bindable('all'),
    showErrorsOnly = $bindable(false),
    minDuration = $bindable(null),
    maxDuration = $bindable(null),
    filteredCount,
    totalCount,
    searchInputEl = $bindable(null),
  }: Props = $props()

  const hasActiveFilters = $derived(
    searchQuery.trim() !== '' ||
      selectedService !== 'all' ||
      showErrorsOnly ||
      minDuration !== null ||
      maxDuration !== null,
  )

  function handleClear() {
    searchQuery = ''
    selectedService = 'all'
    showErrorsOnly = false
    minDuration = null
    maxDuration = null
  }
</script>

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
      <select id="service" bind:value={selectedService} class="filter-select">
        <option value="all">All Services</option>
        {#each services as service}
          <option value={service}>{service}</option>
        {/each}
      </select>
    </div>

    <div class="filter-group">
      <span class="filter-label">Status</span>
      <label class="checkbox-label">
        <input id="errors-only" type="checkbox" bind:checked={showErrorsOnly} />
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
      <button onclick={handleClear} class="clear-filters-btn">
        Clear Filters
      </button>
    {/if}
  </div>

  <div class="filter-stats">
    Showing <strong>{filteredCount}</strong> of
    <strong>{totalCount}</strong> traces
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

  .checkbox-label input[type='checkbox'] {
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
</style>
