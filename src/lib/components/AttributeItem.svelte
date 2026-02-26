<script lang="ts">
  import CopyButton from "$lib/components/CopyButton.svelte";
  const TRUNCATE_LENGTH = 200;

  interface Props {
    attrKey: string;
    value: unknown;
    onFullscreen?: (key: string, formatted: string) => void;
  }

  let { attrKey, value, onFullscreen }: Props = $props();

  let isExpanded = $state(false);

  function formatValue(v: unknown): string {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v, null, 2);
  }

  const formatted = $derived(formatValue(value));
  const needsTruncation = $derived(formatted.length > TRUNCATE_LENGTH);
  const isMultiline = $derived(formatted.includes("\n"));
  const displayValue = $derived(
    needsTruncation && !isExpanded
      ? formatted.slice(0, TRUNCATE_LENGTH) + "…"
      : formatted,
  );

  function valueType(v: unknown): string {
    if (v === null || v === undefined) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  }

  const typeLabel = $derived(valueType(value));
</script>

<div class="attribute-item">
  <div class="attr-header">
    <div class="attr-key-group">
      <span class="attr-key">{attrKey}</span>
      <span class="attr-type attr-type--{typeLabel}">{typeLabel}</span>
    </div>
    <div class="attr-actions">
      <CopyButton
        text={formatted}
        size={12}
        label={attrKey}
        class="attr-action-btn"
      />
      {#if needsTruncation || isMultiline}
        <button
          class="attr-action-btn"
          onclick={() => onFullscreen?.(attrKey, formatted)}
          title="View full value"
          aria-label="View full value for {attrKey}"
        >
          <span class="icon-expand">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 5V1H5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M9 1H13V5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M13 9V13H9"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M5 13H1V9"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>
      {/if}
    </div>
  </div>
  <pre class="attr-value" class:multiline={isMultiline}>{displayValue}</pre>
  {#if needsTruncation}
    <button class="expand-btn" onclick={() => (isExpanded = !isExpanded)}>
      {isExpanded ? "Show less" : "Show more"}
    </button>
  {/if}
</div>

<style>
  .attribute-item {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-muted);
  }

  .attribute-item:last-child {
    border-bottom: none;
  }

  .attr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .attr-key-group {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
  }

  .attr-key {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    word-break: break-word;
  }

  .attr-type {
    font-size: 0.65rem;
    font-weight: 500;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    border: 1px solid;
    white-space: nowrap;
    flex-shrink: 0;
    font-family: monospace;
    line-height: 1.6;
  }

  /* Per-type colours */
  .attr-type--string {
    color: var(--attr-string-text);
    border-color: var(--attr-string-border);
    background: var(--attr-string-bg);
  }
  .attr-type--number {
    color: var(--attr-number-text);
    border-color: var(--attr-number-border);
    background: var(--attr-number-bg);
  }
  .attr-type--boolean {
    color: var(--attr-boolean-text);
    border-color: var(--attr-boolean-border);
    background: var(--attr-boolean-bg);
  }
  .attr-type--array {
    color: var(--attr-array-text);
    border-color: var(--attr-array-border);
    background: var(--attr-array-bg);
  }
  .attr-type--object {
    color: var(--attr-object-text);
    border-color: var(--attr-object-border);
    background: var(--attr-object-bg);
  }
  .attr-type--null {
    color: var(--attr-null-text);
    border-color: var(--attr-null-border);
    background: var(--attr-null-bg);
  }

  /* CopyButton override: match attr-action-btn sizing and border style */
  .attribute-item :global(.copy-btn.attr-action-btn) {
    width: 22px;
    height: 22px;
    border-color: var(--border);
    border-radius: 3px;
    color: var(--text-secondary);
  }

  .attr-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s ease;
  }

  .attribute-item:hover .attr-actions {
    opacity: 1;
  }

  .attr-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1;
    transition:
      background 0.1s ease,
      color 0.1s ease,
      border-color 0.1s ease;
  }

  .attr-action-btn:hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .attr-action-btn.copied {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .icon-expand {
    line-height: 1;
  }

  .attr-value {
    font-family: monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    background: transparent;
    padding: 0;
    line-height: 1.5;
  }

  .attr-value.multiline {
    background: var(--bg-code);
    border-radius: 3px;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border);
    word-break: break-word;
  }

  .expand-btn {
    margin-top: 0.25rem;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.1s ease;
  }

  .expand-btn:hover {
    color: var(--accent-hover);
  }
</style>
