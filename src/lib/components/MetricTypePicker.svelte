<script lang="ts">
  import { tick } from 'svelte'

  export type MetricTypeFilter =
    | 'all'
    | 'gauge'
    | 'sum'
    | 'histogram'
    | 'exp_histogram'
    | 'summary'

  interface Props {
    selectedType: MetricTypeFilter
    id?: string
    ariaLabel?: string
    allLabel?: string
  }

  let {
    selectedType = $bindable('all'),
    id = 'metric-type-picker',
    ariaLabel = 'Metric type',
    allLabel = 'All types',
  }: Props = $props()

  const typeOptions = $derived([
    { value: 'all' as const, label: allLabel },
    { value: 'gauge' as const, label: 'Gauge' },
    { value: 'sum' as const, label: 'Sum' },
    { value: 'histogram' as const, label: 'Histogram' },
    { value: 'exp_histogram' as const, label: 'Exp. Histogram' },
    { value: 'summary' as const, label: 'Summary' },
  ])

  let typeMenuOpen = $state(false)
  let typeTriggerEl = $state<HTMLButtonElement | null>(null)
  let typeOptionButtons = $state<Array<HTMLButtonElement | null>>([])
  let activeTypeIndex = $state(0)

  function typeIndex(): number {
    const idx = typeOptions.findIndex((option) => option.value === selectedType)
    return idx >= 0 ? idx : 0
  }

  function selectedTypeOption() {
    return typeOptions.find((option) => option.value === selectedType)
  }

  async function openTypeMenu(options?: {
    focusOption?: boolean
    focusSelected?: boolean
  }) {
    const { focusOption = false, focusSelected = false } = options ?? {}

    if (!typeMenuOpen) {
      typeMenuOpen = true
      await tick()
    }

    if (focusSelected) {
      activeTypeIndex = typeIndex()
    }

    if (focusOption) {
      focusActiveTypeOption()
    }
  }

  function closeTypeMenu(focusTrigger = false) {
    typeMenuOpen = false
    if (focusTrigger) {
      typeTriggerEl?.focus()
    }
  }

  function focusActiveTypeOption() {
    typeOptionButtons[activeTypeIndex]?.focus()
  }

  function moveActiveTypeIndex(delta: number) {
    const count = typeOptions.length
    if (count === 0) return

    const next = (activeTypeIndex + delta + count) % count
    activeTypeIndex = next
    focusActiveTypeOption()
  }

  function setActiveTypeIndex(nextIndex: number) {
    const lastIndex = typeOptions.length - 1
    if (lastIndex < 0) return

    const clamped = Math.max(0, Math.min(nextIndex, lastIndex))
    activeTypeIndex = clamped
    focusActiveTypeOption()
  }

  function selectType(value: MetricTypeFilter) {
    selectedType = value
    typeMenuOpen = false
  }

  function selectActiveType() {
    const option = typeOptions[activeTypeIndex]
    if (!option) return
    selectType(option.value)
    typeTriggerEl?.focus()
  }

  async function handleTypeTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      await openTypeMenu({ focusOption: true, focusSelected: true })
      if (typeOptions.length > 1) {
        moveActiveTypeIndex(1)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      await openTypeMenu({ focusOption: true, focusSelected: true })
      if (typeOptions.length > 1) {
        moveActiveTypeIndex(-1)
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!typeMenuOpen) {
        await openTypeMenu({ focusOption: true, focusSelected: true })
      } else {
        selectActiveType()
      }
      return
    }

    if (event.key === 'Escape' && typeMenuOpen) {
      event.preventDefault()
      closeTypeMenu(true)
    }
  }

  function handleTypeMenuKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActiveTypeIndex(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveActiveTypeIndex(-1)
        return
      case 'Home':
        event.preventDefault()
        setActiveTypeIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveTypeIndex(typeOptions.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectActiveType()
        return
      case 'Escape':
        event.preventDefault()
        closeTypeMenu(true)
        return
      case 'Tab':
        closeTypeMenu(false)
        return
    }
  }

  function handleTypeMenuFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget as Node | null
    if (!event.currentTarget || !(event.currentTarget instanceof HTMLElement)) {
      typeMenuOpen = false
      return
    }
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return
    }
    closeTypeMenu(false)
  }
</script>

<div class="type-picker" onfocusout={handleTypeMenuFocusOut}>
  <button
    {id}
    type="button"
    bind:this={typeTriggerEl}
    class="type-picker-trigger"
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={typeMenuOpen}
    onkeydown={handleTypeTriggerKeydown}
    onclick={() => {
      if (typeMenuOpen) {
        closeTypeMenu(false)
        return
      }
      void openTypeMenu({ focusSelected: true })
    }}
  >
    {#if selectedType === 'all'}
      <span class="type-picker-placeholder">{allLabel}</span>
    {:else}
      <span class={`type-badge type-${selectedType}`}>
        {selectedTypeOption()?.label ?? selectedType}
      </span>
    {/if}
    <span class="type-picker-chevron" aria-hidden="true">▾</span>
  </button>

  {#if typeMenuOpen}
    <ul
      class="type-picker-menu"
      role="listbox"
      aria-label={ariaLabel}
      onkeydown={handleTypeMenuKeydown}
    >
      {#each typeOptions as option, index (option.value)}
        <li role="option" aria-selected={selectedType === option.value}>
          <button
            type="button"
            class="type-picker-option"
            tabindex={activeTypeIndex === index ? 0 : -1}
            bind:this={typeOptionButtons[index]}
            onfocus={() => {
              activeTypeIndex = index
            }}
            onclick={() => {
              activeTypeIndex = index
              selectType(option.value)
              typeTriggerEl?.focus()
            }}
          >
            {#if option.value === 'all'}
              {option.label}
            {:else}
              <span class={`type-badge type-${option.value}`}>
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
  .type-picker {
    position: relative;
  }

  .type-picker-trigger {
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

  .type-picker-trigger:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .type-picker-placeholder {
    color: var(--text-primary);
  }

  .type-picker-chevron {
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

  .type-picker-menu {
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

  .type-picker-option {
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

  .type-picker-option:hover {
    background: var(--bg-muted);
  }

  .type-badge {
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

  .type-gauge {
    color: #0f4c81;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .type-sum {
    color: #92400e;
    background: #fff7ed;
    border-color: #fed7aa;
  }

  .type-histogram {
    color: #4c1d95;
    background: #f5f3ff;
    border-color: #ddd6fe;
  }

  .type-exp_histogram {
    color: #155e75;
    background: #ecfeff;
    border-color: #a5f3fc;
  }

  .type-summary {
    color: #166534;
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
</style>
