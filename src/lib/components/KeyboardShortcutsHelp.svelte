<script lang="ts">
  import { autoFocus } from "$lib/actions/autoFocus";
  export interface Shortcut {
    keys: string[];
    description: string;
  }

  let { shortcuts, onclose }: { shortcuts: Shortcut[]; onclose: () => void } =
    $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Keyboard shortcuts"
>
  <button class="backdrop" onclick={onclose} aria-label="Close" tabindex="-1"
  ></button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" tabindex="-1" onkeydown={handleKeydown} use:autoFocus>
    <div class="modal-header">
      <span class="modal-title">Keyboard Shortcuts</span>
      <button class="close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>
    <div class="modal-body">
      <table class="shortcuts-table">
        <tbody>
          {#each shortcuts as shortcut}
            <tr>
              <td class="keys-cell">
                {#each shortcut.keys as key}
                  <kbd>{key}</kbd>
                {/each}
              </td>
              <td class="desc-cell">{shortcut.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow:
      0 8px 32px var(--shadow),
      0 2px 8px var(--shadow-sm);
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-code);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
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

  .close-btn:hover {
    background: var(--error-bg);
    border-color: var(--error-text);
    color: var(--error-text);
  }

  .modal-body {
    overflow-y: auto;
    padding: 0.75rem 0;
  }

  .shortcuts-table {
    width: 100%;
    border-collapse: collapse;
  }

  .shortcuts-table tr {
    border-bottom: 1px solid var(--border-light);
  }

  .shortcuts-table tr:last-child {
    border-bottom: none;
  }

  .keys-cell {
    padding: 0.625rem 1rem;
    white-space: nowrap;
    vertical-align: middle;
    width: 1%;
  }

  .keys-cell kbd {
    display: inline-block;
    padding: 0.2rem 0.45rem;
    font-family: monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    background: var(--bg-code, var(--bg-muted));
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    box-shadow: 0 1px 0 var(--border);
    margin-right: 0.25rem;
  }

  .keys-cell kbd:last-child {
    margin-right: 0;
  }

  .desc-cell {
    padding: 0.625rem 1rem 0.625rem 0.25rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    vertical-align: middle;
  }
</style>
