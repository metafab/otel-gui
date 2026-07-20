<script lang="ts">
  import { tick } from 'svelte'

  export type SeverityFilter =
    | 'all'
    | 'trace'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'

  interface Props {
    selectedSeverity: SeverityFilter
    id?: string
    ariaLabel?: string
    allLabel?: string
  }

  let {
    selectedSeverity = $bindable('all'),
    id = 'severity-picker',
    ariaLabel = 'Severity',
    allLabel = 'All Severities',
  }: Props = $props()

  const severityOptions = $derived([
    { value: 'all' as const, label: allLabel },
    { value: 'error' as const, label: 'Error+' },
    { value: 'warn' as const, label: 'Warn' },
    { value: 'info' as const, label: 'Info' },
    { value: 'debug' as const, label: 'Debug' },
    { value: 'trace' as const, label: 'Trace' },
  ])

  let severityMenuOpen = $state(false)
  let severityTriggerEl = $state<HTMLButtonElement | null>(null)
  let severityOptionButtons = $state<Array<HTMLButtonElement | null>>([])
  let activeSeverityIndex = $state(0)

  function severityIndex(): number {
    const idx = severityOptions.findIndex(
      (option) => option.value === selectedSeverity,
    )
    return idx >= 0 ? idx : 0
  }

  function selectedSeverityOption() {
    return severityOptions.find((option) => option.value === selectedSeverity)
  }

  async function openSeverityMenu(options?: {
    focusOption?: boolean
    focusSelected?: boolean
  }) {
    const { focusOption = false, focusSelected = false } = options ?? {}

    if (!severityMenuOpen) {
      severityMenuOpen = true
      await tick()
    }

    if (focusSelected) {
      activeSeverityIndex = severityIndex()
    }

    if (focusOption) {
      focusActiveSeverityOption()
    }
  }

  function closeSeverityMenu(focusTrigger = false) {
    severityMenuOpen = false
    if (focusTrigger) {
      severityTriggerEl?.focus()
    }
  }

  function focusActiveSeverityOption() {
    severityOptionButtons[activeSeverityIndex]?.focus()
  }

  function moveActiveSeverityIndex(delta: number) {
    const count = severityOptions.length
    if (count === 0) return

    const next = (activeSeverityIndex + delta + count) % count
    activeSeverityIndex = next
    focusActiveSeverityOption()
  }

  function setActiveSeverityIndex(nextIndex: number) {
    const lastIndex = severityOptions.length - 1
    if (lastIndex < 0) return

    const clamped = Math.max(0, Math.min(nextIndex, lastIndex))
    activeSeverityIndex = clamped
    focusActiveSeverityOption()
  }

  function selectSeverity(value: SeverityFilter) {
    selectedSeverity = value
    severityMenuOpen = false
  }

  function selectActiveSeverity() {
    const option = severityOptions[activeSeverityIndex]
    if (!option) return
    selectSeverity(option.value)
    severityTriggerEl?.focus()
  }

  async function handleSeverityTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      await openSeverityMenu({ focusOption: true, focusSelected: true })
      if (severityOptions.length > 1) {
        moveActiveSeverityIndex(1)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      await openSeverityMenu({ focusOption: true, focusSelected: true })
      if (severityOptions.length > 1) {
        moveActiveSeverityIndex(-1)
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!severityMenuOpen) {
        await openSeverityMenu({ focusOption: true, focusSelected: true })
      } else {
        selectActiveSeverity()
      }
      return
    }

    if (event.key === 'Escape' && severityMenuOpen) {
      event.preventDefault()
      closeSeverityMenu(true)
    }
  }

  function handleSeverityMenuKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActiveSeverityIndex(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveActiveSeverityIndex(-1)
        return
      case 'Home':
        event.preventDefault()
        setActiveSeverityIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveSeverityIndex(severityOptions.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectActiveSeverity()
        return
      case 'Escape':
        event.preventDefault()
        closeSeverityMenu(true)
        return
      case 'Tab':
        closeSeverityMenu(false)
        return
    }
  }

  function handleSeverityMenuFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget as Node | null
    if (!event.currentTarget || !(event.currentTarget instanceof HTMLElement)) {
      severityMenuOpen = false
      return
    }
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return
    }
    closeSeverityMenu(false)
  }
</script>

<div class="severity-picker" onfocusout={handleSeverityMenuFocusOut}>
  <button
    {id}
    type="button"
    bind:this={severityTriggerEl}
    class="severity-picker-trigger"
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={severityMenuOpen}
    onkeydown={handleSeverityTriggerKeydown}
    onclick={() => {
      if (severityMenuOpen) {
        closeSeverityMenu(false)
        return
      }
      void openSeverityMenu({ focusSelected: true })
    }}
  >
    {#if selectedSeverity === 'all'}
      <span class="severity-picker-placeholder">{allLabel}</span>
    {:else}
      <span class={`severity-badge severity-${selectedSeverity}`}>
        {selectedSeverityOption()?.label ?? selectedSeverity}
      </span>
    {/if}
    <span class="severity-picker-chevron" aria-hidden="true">▾</span>
  </button>

  {#if severityMenuOpen}
    <ul
      class="severity-picker-menu"
      role="listbox"
      aria-label={ariaLabel}
      onkeydown={handleSeverityMenuKeydown}
    >
      {#each severityOptions as option, index (option.value)}
        <li role="option" aria-selected={selectedSeverity === option.value}>
          <button
            type="button"
            class="severity-picker-option"
            tabindex={activeSeverityIndex === index ? 0 : -1}
            bind:this={severityOptionButtons[index]}
            onfocus={() => {
              activeSeverityIndex = index
            }}
            onclick={() => {
              activeSeverityIndex = index
              selectSeverity(option.value)
              severityTriggerEl?.focus()
            }}
          >
            {#if option.value === 'all'}
              {option.label}
            {:else}
              <span class={`severity-badge severity-${option.value}`}>
                {option.label}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .severity-picker {
    position: relative;
  }

  .severity-picker-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-align: left;
    cursor: pointer;
    min-height: 38px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .severity-picker-trigger:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .severity-picker-placeholder {
    color: var(--text-primary);
  }

  .severity-picker-chevron {
    color: var(--text-secondary);
    margin-left: 0.5rem;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1;
    transform: translateY(-1px) scale(1.15);
    transform-origin: center;
  }

  .severity-picker-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 15;
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 20px var(--shadow);
    max-height: 220px;
    overflow-y: auto;
  }

  .severity-picker-option {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .severity-picker-option:hover {
    background: var(--bg-muted);
  }

  .severity-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.4rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    border: 1px solid transparent;
    text-transform: uppercase;
  }

  .severity-error {
    color: var(--error-text);
    background: var(--error-bg);
    border-color: var(--error-border);
  }

  .severity-warn {
    color: #92400e;
    background: #fff7ed;
    border-color: #fed7aa;
  }

  .severity-info {
    color: #0f4c81;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .severity-debug,
  .severity-trace {
    color: var(--text-secondary);
    background: var(--bg-surface-hover);
    border-color: var(--border);
  }
</style>
