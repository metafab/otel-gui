<script lang="ts">
  import SeverityPicker from '$lib/components/SeverityPicker.svelte'
  import ServicePicker from '$lib/components/ServicePicker.svelte'

  interface Props {
    services: string[]
    searchQuery: string
    selectedService: string
    severityFilter: 'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error'
    filteredCount: number
    totalCount: number
  }

  let {
    services,
    searchQuery = $bindable(''),
    selectedService = $bindable('all'),
    severityFilter = $bindable('all'),
    filteredCount,
    totalCount,
  }: Props = $props()

  const hasActiveFilters = $derived(
    searchQuery.trim() !== '' ||
      selectedService !== 'all' ||
      severityFilter !== 'all',
  )

  function handleClear() {
    searchQuery = ''
    selectedService = 'all'
    severityFilter = 'all'
  }
</script>

<div class="filters">
  <div class="filter-row">
    <div class="filter-group search-group">
      <label for="logs-search">Search</label>
      <input
        id="logs-search"
        type="text"
        bind:value={searchQuery}
        placeholder="Search by service, severity, body, traceId, spanId..."
        class="search-input"
        aria-label="Search logs"
      />
    </div>

    <div class="filter-group severity-group">
      <label for="logs-service">Service</label>
      <ServicePicker
        id="logs-service"
        ariaLabel="Service"
        allLabel="All services"
        {services}
        bind:selectedService
      />
    </div>

    <div class="filter-group severity-group">
      <label for="logs-severity">Severity</label>
      <SeverityPicker
        id="logs-severity"
        ariaLabel="Severity"
        allLabel="All severities"
        bind:selectedSeverity={severityFilter}
      />
    </div>
  </div>

  <div class="filter-stats">
    <div>
      Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> logs
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

  .severity-group {
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
    .severity-group {
      min-width: 100%;
      max-width: none;
    }

    .filter-stats {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
