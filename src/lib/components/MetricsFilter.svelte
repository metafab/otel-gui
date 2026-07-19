<script lang="ts">
  import MetricTypePicker from '$lib/components/MetricTypePicker.svelte'
  import ServicePicker from '$lib/components/ServicePicker.svelte'

  interface Props {
    /** Available service names for the dropdown. */
    services: string[]
    searchQuery: string
    typeFilter:
      | 'all'
      | 'gauge'
      | 'sum'
      | 'histogram'
      | 'exp_histogram'
      | 'summary'
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
        placeholder="Search name, unit, or any series attribute…"
        class="search-input"
        aria-label="Search metrics"
      />
    </div>

    <div class="filter-group service-group">
      <label for="metrics-service">Service</label>
      <ServicePicker
        id="metrics-service"
        ariaLabel="Service"
        allLabel="All services"
        {services}
        bind:selectedService
      />
    </div>

    <div class="filter-group type-group">
      <label for="metrics-type">Type</label>
      <MetricTypePicker
        id="metrics-type"
        ariaLabel="Metric type"
        allLabel="All types"
        bind:selectedType={typeFilter}
      />
    </div>
  </div>

  <div class="filter-stats">
    <div>
      Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> metrics
    </div>
    {#if hasActiveFilters}
      <button onclick={handleClear} class="clear-filters-btn"
        >Clear Filters</button
      >
    {/if}
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

  .search-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .clear-filters-btn {
    padding: 0.2rem 0.4rem;
    background: var(--bg-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    white-space: nowrap;
    align-self: flex-end;
    transition: background 0.15s ease;
  }

  .clear-filters-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .filter-stats {
    display: flex;
    align-items: center;
    justify-content: space-between;
    block-size: 1.5rem;
    gap: 0.75rem;
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

    .filter-stats {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
