<script lang="ts">
  let {
    totalCount,
    selectedCount,
    isDeleting,
    onClearAll,
    onDeleteSelected,
  }: {
    totalCount: number
    selectedCount: number
    isDeleting: boolean
    onClearAll: () => void
    onDeleteSelected: () => void
  } = $props()

  let showClearMenu = $state(false)
  let clearSplitContainer = $state<HTMLElement | null>(null)

  $effect(() => {
    if (typeof document === 'undefined') return

    function onPointerDown(event: MouseEvent) {
      if (!showClearMenu) return
      const target = event.target as Node | null
      if (
        clearSplitContainer &&
        target &&
        !clearSplitContainer.contains(target)
      ) {
        showClearMenu = false
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') showClearMenu = false
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
    }
  })
</script>

<div
  class="split-action"
  role="group"
  aria-label="Log deletion actions"
  bind:this={clearSplitContainer}
>
  <button
    class="action-button split-primary"
    onclick={onClearAll}
    disabled={totalCount === 0 || isDeleting}
  >
    Clear All
  </button>
  <button
    class="action-button split-toggle"
    onclick={(e) => {
      e.stopPropagation()
      showClearMenu = !showClearMenu
    }}
    disabled={totalCount === 0 || isDeleting}
    aria-label="More clear actions"
    aria-expanded={showClearMenu}
    title="More clear actions"
  >
    ▼
  </button>
  {#if showClearMenu}
    <div class="split-menu" role="menu" aria-label="Clear actions menu">
      <button
        class="split-menu-item"
        role="menuitem"
        onclick={() => {
          showClearMenu = false
          onDeleteSelected()
        }}
        disabled={selectedCount === 0 || isDeleting}
      >
        Delete Selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </button>
    </div>
  {/if}
</div>
