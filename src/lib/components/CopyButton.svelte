<script lang="ts">
  import { copyToClipboard } from '#lib/utils/clipboard.js'

  interface Props {
    /** Text to write to the clipboard. */
    text: string
    /** Pixel size for the SVG icons. Defaults to 12. */
    size?: number
    /** Optional accessible label suffix (e.g. "for http.method"). */
    label?: string
    /** Extra CSS classes forwarded to the button element. */
    class?: string
    /** When true, renders "Copy" / "Copied" text next to the icon. */
    showLabel?: boolean
    /** What is being copied, used in the tooltip and accessible label. Defaults to "value". */
    subject?: string
  }

  let {
    text,
    size = 12,
    label = '',
    class: extraClass = '',
    showLabel = false,
    subject = 'value',
  }: Props = $props()

  let copied = $state(false)

  // Each click gets a token so a stale reset timer from an earlier click
  // can't cut the "copied" state short after a later click.
  let latestClick = 0

  async function handleClick() {
    const click = ++latestClick
    await copyToClipboard(text, (isCopied) => {
      if (isCopied || click === latestClick) copied = isCopied
    })
  }
</script>

<button
  class="copy-btn {extraClass}"
  class:copied
  onclick={handleClick}
  title="Copy {subject}"
  aria-label={label ? `Copy ${subject} for ${label}` : `Copy ${subject}`}
>
  {#if copied}
    <span class="icon-copied">
      <svg
        width={size}
        height={size}
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
    {#if showLabel}Copied{/if}
  {:else}
    <span class="icon-copy">
      <svg
        width={size}
        height={size}
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
    </span>
    {#if showLabel}Copy{/if}
  {/if}
</button>

<style>
  .copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    flex-shrink: 0;
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
    /* Size is driven by the caller; provide a sensible minimum tap target */
    min-width: 22px;
    min-height: 22px;
  }

  .copy-btn:hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .copy-btn.copied {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .icon-copy,
  .icon-copied {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
