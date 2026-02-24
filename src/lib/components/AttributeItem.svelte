<script lang="ts">
  const TRUNCATE_LENGTH = 200;

  interface Props {
    attrKey: string;
    value: unknown;
    onFullscreen?: (key: string, formatted: string) => void;
  }

  let { attrKey, value, onFullscreen }: Props = $props();

  let isExpanded = $state(false);
  let copied = $state(false);

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

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(formatted);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 1500);
    } catch {
      // Fallback for environments without clipboard API
    }
  }
</script>

<div class="attribute-item">
  <div class="attr-header">
    <div class="attr-key-group">
      <span class="attr-key">{attrKey}</span>
      <span class="attr-type attr-type--{typeLabel}">{typeLabel}</span>
    </div>
    <div class="attr-actions">
      <button
        class="attr-action-btn"
        class:copied
        onclick={copyValue}
        title="Copy value"
        aria-label="Copy value for {attrKey}"
      >
        {#if copied}
          <span class="icon-copied">
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              ><polyline
                points="2,7 5.5,10.5 12,3"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              /></svg
            >
          </span>
        {:else}
          <span class="icon-copy">
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              ><rect
                x="4"
                y="1"
                width="9"
                height="10"
                rx="1.2"
                stroke="currentColor"
                stroke-width="1.4"
              /><rect
                x="1"
                y="3"
                width="9"
                height="10"
                rx="1.2"
                stroke="currentColor"
                stroke-width="1.4"
                fill="white"
              /></svg
            >
          </span>
        {/if}
      </button>
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
    border-bottom: 1px solid #efefef;
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
    color: #1976d2;
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
    color: #2e7d32;
    border-color: #a5d6a7;
    background: #f1f8f1;
  }
  .attr-type--number {
    color: #1565c0;
    border-color: #90caf9;
    background: #f0f4ff;
  }
  .attr-type--boolean {
    color: #6a1b9a;
    border-color: #ce93d8;
    background: #fdf4ff;
  }
  .attr-type--array {
    color: #e65100;
    border-color: #ffcc80;
    background: #fff8f0;
  }
  .attr-type--object {
    color: #4e342e;
    border-color: #bcaaa4;
    background: #fdf8f6;
  }
  .attr-type--null {
    color: #757575;
    border-color: #bdbdbd;
    background: #f5f5f5;
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
    border: 1px solid #e0e0e0;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8rem;
    color: #666;
    line-height: 1;
    transition:
      background 0.1s ease,
      color 0.1s ease,
      border-color 0.1s ease;
  }

  .attr-action-btn:hover {
    background: #f0f4ff;
    border-color: #1976d2;
    color: #1976d2;
  }

  .attr-action-btn.copied {
    background: #e8f5e9;
    border-color: #388e3c;
    color: #388e3c;
  }

  .icon-copy,
  .icon-copied,
  .icon-expand {
    line-height: 1;
  }

  .attr-value {
    font-family: monospace;
    font-size: 0.8125rem;
    color: #333;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    background: transparent;
    padding: 0;
    line-height: 1.5;
  }

  .attr-value.multiline {
    background: #f6f8fa;
    border-radius: 3px;
    padding: 0.375rem 0.5rem;
    border: 1px solid #e8e8e8;
    word-break: break-word;
  }

  .expand-btn {
    margin-top: 0.25rem;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.75rem;
    color: #1976d2;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.1s ease;
  }

  .expand-btn:hover {
    color: #1565c0;
  }
</style>
