<script lang="ts">
  interface Props {
    /** Available service names for the dropdown. */
    services: string[]
    searchQuery: string
    typeFilter: 'all' | 'gauge' | 'sum'
    /** Bound: selected service name, or "all". */
    selectedService: string
    filteredCount: number
    totalCount: number
  }

  let {
    services,
    searchQuery = $bindable(''),
    typeFilter = $bindable('all'),
    selectedService = $bindable('all'),
    filteredCount,
    totalCount,
  }: Props = $props()

  const hasActiveFilters = $derived(
    searchQuery.trim() !== '' ||
      typeFilter !== 'all' ||
      selectedService !== 'all',
  )

  function handleClear() {
    searchQuery = ''
    typeFilter = 'all'
    selectedService = 'all'
  }
</script>

<div class="filters">
  <div class="filter-row">
    <div class="filter-group search-group">
      <label for="metrics-search">Search</label>
      <input
        id="metrics-search"
        type="text"
        bind:value={searchQuery}
        placeholder="Search by name, service, unit..."
        class="search-input"
        aria-label="Search metrics"
      />
    </div>

    <div class="filter-group service-group">
      <label for="metrics-service">Service</label>
      <select
        id="metrics-service"
        bind:value={selectedService}
        class="filter-select"
        aria-label="Service"
      >
        <option value="all">All Services</option>
        {#each services as service}
          <option value={service}>{service}</option>
        {/each}
      </select>
    </div>

    <div class="filter-group type-group">
      <label for="metrics-type">Type</label>
      <select
        id="metrics-type"
        bind:value={typeFilter}
        class="filter-select"
        aria-label="Metric type"
      >
        <option value="all">All types</option>
        <option value="gauge">Gauge</option>
        <option value="sum">Sum</option>
      </select>
    </div>

    {#if hasActiveFilters}
      <button onclick={handleClear} class="clear-filters-btn"
        >Clear Filters</button
      >
    {/if}
  </div>

  <div class="filter-stats">
    Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> metrics
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

  .type-group,
  .service-group {
    max-width: 220px;
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

  @media (max-width: 768px) {
    .filters {
      padding: 1rem;
      margin-bottom: 1rem;
    }

    .search-group,
    .type-group,
    .service-group {
      min-width: 100%;
      max-width: none;
    }
  }
</style>
