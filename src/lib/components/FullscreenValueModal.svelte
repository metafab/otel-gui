<script lang="ts">
  import { autoFocus } from "$lib/actions/autoFocus";
  import { copyToClipboard } from "$lib/utils/clipboard";

  interface Props {
    /** The attribute key/value to display. Pass `null` to hide the modal. */
    attr: { key: string; value: string } | null;
    onclose: () => void;
  }

  let { attr, onclose }: Props = $props();

  let copied = $state(false);

  async function handleCopy() {
    if (!attr) return;
    await copyToClipboard(attr.value, (v) => (copied = v));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }

  // Reset copied state when a different attribute is opened
  $effect(() => {
    if (attr) copied = false;
  });
</script>

{#if attr}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fullscreen-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Full attribute value"
  >
    <button
      class="fullscreen-backdrop"
      onclick={onclose}
      aria-label="Close"
      tabindex="-1"
    ></button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fullscreen-modal"
      tabindex="-1"
      onkeydown={handleKeydown}
      use:autoFocus
    >
      <div class="fullscreen-header">
        <span class="fullscreen-key">{attr.key}</span>
        <div class="fullscreen-actions">
          <button
            class="fullscreen-action-btn"
            class:copied
            onclick={handleCopy}
            title="Copy value"
          >
            {#if copied}
              <svg
                width="14"
                height="14"
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
              Copied
            {:else}
              <svg
                width="14"
                height="14"
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
                  style="fill: var(--bg-surface)"
                /></svg
              >
              Copy
            {/if}
          </button>
          <button
            class="fullscreen-close-btn"
            onclick={onclose}
            title="Close (Esc)">✕</button
          >
        </div>
      </div>
      <pre class="fullscreen-value">{attr.value}</pre>
    </div>
  </div>
{/if}

<style>
  .fullscreen-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fullscreen-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    border: none;
    padding: 0;
    cursor: default;
  }

  .fullscreen-modal {
    position: relative;
    z-index: 1;
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow:
      0 8px 32px var(--shadow),
      0 2px 8px var(--shadow-sm);
    width: 75vw;
    height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }

  .fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-code);
    gap: 1rem;
    flex-shrink: 0;
  }

  .fullscreen-key {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent);
    font-family: monospace;
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }

  .fullscreen-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .fullscreen-action-btn {
    padding: 0.375rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--text-primary);
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .fullscreen-action-btn:hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .fullscreen-action-btn.copied {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .fullscreen-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-secondary);
    transition:
      background 0.1s ease,
      color 0.1s ease;
  }

  .fullscreen-close-btn:hover {
    background: var(--error-bg);
    border-color: var(--error-text);
    color: var(--error-text);
  }

  .fullscreen-value {
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--text-primary);
    padding: 1rem;
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    flex: 1;
  }
</style>
