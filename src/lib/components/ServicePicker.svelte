<script lang="ts">
  import { tick } from 'svelte'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'

  interface Props {
    services: string[]
    selectedService: string
    id?: string
    ariaLabel?: string
    allLabel?: string
  }

  let {
    services,
    selectedService = $bindable('all'),
    id = 'service-picker',
    ariaLabel = 'Service',
    allLabel = 'All services',
  }: Props = $props()

  const ALL_SERVICES_VALUE = 'all'

  let serviceMenuOpen = $state(false)
  let servicePickerTriggerEl = $state<HTMLButtonElement | null>(null)
  let serviceOptionButtons = $state<Array<HTMLButtonElement | null>>([])
  let activeServiceIndex = $state(0)

  const serviceOptions = $derived([
    { value: ALL_SERVICES_VALUE, label: allLabel },
    ...services.map((service) => ({ value: service, label: service })),
  ])

  function selectedServiceIndex(): number {
    const idx = serviceOptions.findIndex(
      (option) => option.value === selectedService,
    )
    return idx >= 0 ? idx : 0
  }

  async function openServiceMenu(options?: {
    focusOption?: boolean
    focusSelected?: boolean
  }) {
    const { focusOption = false, focusSelected = false } = options ?? {}

    if (!serviceMenuOpen) {
      serviceMenuOpen = true
      await tick()
    }

    if (focusSelected) {
      activeServiceIndex = selectedServiceIndex()
    }

    if (focusOption) {
      focusActiveServiceOption()
    }
  }

  function closeServiceMenu(focusTrigger = false) {
    serviceMenuOpen = false
    if (focusTrigger) {
      servicePickerTriggerEl?.focus()
    }
  }

  function selectService(service: string) {
    selectedService = service
    serviceMenuOpen = false
  }

  function focusActiveServiceOption() {
    serviceOptionButtons[activeServiceIndex]?.focus()
  }

  function setActiveServiceIndex(nextIndex: number) {
    const lastIndex = serviceOptions.length - 1
    if (lastIndex < 0) return

    const clamped = Math.max(0, Math.min(nextIndex, lastIndex))
    activeServiceIndex = clamped
    focusActiveServiceOption()
  }

  function moveActiveServiceIndex(delta: number) {
    const count = serviceOptions.length
    if (count === 0) return

    const next = (activeServiceIndex + delta + count) % count
    activeServiceIndex = next
    focusActiveServiceOption()
  }

  function selectActiveService() {
    const option = serviceOptions[activeServiceIndex]
    if (!option) return
    selectService(option.value)
    servicePickerTriggerEl?.focus()
  }

  async function handleServiceTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      await openServiceMenu({ focusOption: true, focusSelected: true })
      if (serviceOptions.length > 1) {
        moveActiveServiceIndex(1)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      await openServiceMenu({ focusOption: true, focusSelected: true })
      if (serviceOptions.length > 1) {
        moveActiveServiceIndex(-1)
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!serviceMenuOpen) {
        await openServiceMenu({ focusOption: true, focusSelected: true })
      } else {
        selectActiveService()
      }
      return
    }

    if (event.key === 'Escape' && serviceMenuOpen) {
      event.preventDefault()
      closeServiceMenu(true)
    }
  }

  function handleServiceMenuKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActiveServiceIndex(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveActiveServiceIndex(-1)
        return
      case 'Home':
        event.preventDefault()
        setActiveServiceIndex(0)
        return
      case 'End':
        event.preventDefault()
        setActiveServiceIndex(serviceOptions.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectActiveService()
        return
      case 'Escape':
        event.preventDefault()
        closeServiceMenu(true)
        return
      case 'Tab':
        closeServiceMenu(false)
        return
    }
  }

  function handleServiceMenuFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget as Node | null
    if (!event.currentTarget || !(event.currentTarget instanceof HTMLElement)) {
      serviceMenuOpen = false
      return
    }
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return
    }
    closeServiceMenu(false)
  }
</script>

<div class="service-picker" onfocusout={handleServiceMenuFocusOut}>
  <button
    {id}
    type="button"
    bind:this={servicePickerTriggerEl}
    class="service-picker-trigger"
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={serviceMenuOpen}
    onkeydown={handleServiceTriggerKeydown}
    onclick={() => {
      if (serviceMenuOpen) {
        closeServiceMenu(false)
        return
      }
      void openServiceMenu({ focusSelected: true })
    }}
  >
    {#if selectedService === ALL_SERVICES_VALUE}
      <span class="service-picker-placeholder">{allLabel}</span>
    {:else}
      <ServiceBadge serviceName={selectedService} />
    {/if}
    <span class="service-picker-chevron" aria-hidden="true">▾</span>
  </button>

  {#if serviceMenuOpen}
    <ul
      class="service-picker-menu"
      role="listbox"
      aria-label={ariaLabel}
      onkeydown={handleServiceMenuKeydown}
    >
      {#each serviceOptions as option, index (option.value)}
        <li role="option" aria-selected={selectedService === option.value}>
          <button
            type="button"
            class="service-picker-option"
            tabindex={activeServiceIndex === index ? 0 : -1}
            bind:this={serviceOptionButtons[index]}
            onfocus={() => {
              activeServiceIndex = index
            }}
            onclick={() => {
              activeServiceIndex = index
              selectService(option.value)
              servicePickerTriggerEl?.focus()
            }}
          >
            {#if option.value === ALL_SERVICES_VALUE}
              {option.label}
            {:else}
              <ServiceBadge serviceName={option.label} />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .service-picker {
    position: relative;
  }

  .service-picker-trigger {
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

  .service-picker-trigger:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }

  .service-picker-placeholder {
    color: var(--text-primary);
  }

  .service-picker-chevron {
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

  .service-picker-menu {
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

  .service-picker-option {
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

  .service-picker-option:hover {
    background: var(--bg-muted);
  }
</style>
