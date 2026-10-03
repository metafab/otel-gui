<script lang="ts">
  import { parseAttributeFilter } from '#lib/utils/logAttributeFilters.js'

  interface Props {
    attributeFilters: string[]
    attributeKeys?: string[]
  }

  let { attributeFilters = $bindable([]), attributeKeys = [] }: Props = $props()

  let draft = $state('')
  const listId = 'logs-attribute-keys'

  function addFilter() {
    const parsed = parseAttributeFilter(draft)
    if (!parsed) return
    if (!attributeFilters.includes(parsed.raw)) {
      attributeFilters = [...attributeFilters, parsed.raw]
    }
    draft = ''
  }

  function removeFilter(raw: string) {
    attributeFilters = attributeFilters.filter((filter) => filter !== raw)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addFilter()
    } else if (
      event.key === 'Backspace' &&
      draft === '' &&
      attributeFilters.length > 0
    ) {
      attributeFilters = attributeFilters.slice(0, -1)
    }
  }
</script>

<div class="attribute-filter">
  <label for="logs-attribute-filter">Attributes</label>
  <div class="attribute-filter-box">
    {#each attributeFilters as filter (filter)}
      <span class="filter-chip" data-testid="attribute-filter-chip">
        <span class="filter-chip-text">{filter}</span>
        <button
          type="button"
          class="filter-chip-remove"
          aria-label={`Remove filter ${filter}`}
          onclick={() => removeFilter(filter)}>×</button
        >
      </span>
    {/each}
    <input
      id="logs-attribute-filter"
      type="text"
      bind:value={draft}
      onkeydown={handleKeydown}
      list={listId}
      placeholder="key, !key, key=value, key!=value, key~value, key!~value"
      title="key: exists · !key: missing · key=value: equals · key!=value: not equal · key~value: contains (ignore case) · key!~value: does not contain. Press Enter to add."
      class="attribute-filter-input"
      aria-label="Filter by attributes"
      autocomplete="off"
    />
    <datalist id={listId}>
      {#each attributeKeys as key (key)}
        <option value={key}></option>
      {/each}
    </datalist>
  </div>
</div>

<style>
  .attribute-filter {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-width: 300px;
  }

  label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .attribute-filter-box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
  }

  .attribute-filter-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .attribute-filter-input {
    flex: 1;
    min-width: 14rem;
    padding: 0.25rem 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.25rem 0.0625rem 0.5rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    color: var(--accent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    font-size: 0.75rem;
  }

  .filter-chip-remove {
    padding: 0 0.25rem;
    border: none;
    border-radius: 999px;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1;
  }

  .filter-chip-remove:hover {
    background: color-mix(in oklab, var(--accent) 25%, transparent);
  }
</style>
