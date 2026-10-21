<script lang="ts">
  import { formatAttributeValue } from '#lib/utils/logAttributeFilters.js'

  interface Props {
    attributes: Record<string, unknown>
  }

  let { attributes }: Props = $props()

  const entries = $derived(
    Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)),
  )
</script>

<div class="inline-attrs">
  {#each entries as [key, value] (key)}
    <span class="inline-attr" title={`${key}=${formatAttributeValue(value)}`}>
      <span class="inline-attr-key">{key}</span>
      <span class="inline-attr-value">{formatAttributeValue(value)}</span>
    </span>
  {/each}
</div>

<style>
  .inline-attrs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.375rem;
  }

  .inline-attr {
    display: inline-flex;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-muted);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    font-size: 0.6875rem;
    overflow: hidden;
  }

  .inline-attr-key {
    padding: 0.0625rem 0.375rem;
    color: var(--accent);
    border-right: 1px solid var(--border);
    white-space: nowrap;
  }

  .inline-attr-value {
    padding: 0.0625rem 0.375rem;
    color: var(--text-primary);
    max-width: 24rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
