<script lang="ts">
  import type { StoredSpan } from '$lib/types'
  import { formatDuration } from '$lib/utils/time'
  import { getServiceColor } from '$lib/utils/colors'
  import { themeStore } from '$lib/stores/theme.svelte'
  import { spanKindLabel } from '$lib/utils/spans'
  import ServiceBadge from '$lib/components/ServiceBadge.svelte'

  interface Props {
    span: StoredSpan
    depth: number
    traceStartNano: string
    traceDurationNs: bigint
    isSelected: boolean
    isHighlighted?: boolean
    hasChildren?: boolean
    isCollapsed?: boolean
    childCount?: number
    subtreeSize?: number
    nameColumnWidth?: number
    onSelect: () => void
    onToggleCollapse?: () => void
    onEventClick?: (eventIndex: number) => void
  }

  let {
    span,
    depth,
    traceStartNano,
    traceDurationNs,
    isSelected,
    isHighlighted = false,
    hasChildren = false,
    isCollapsed = false,
    childCount = 0,
    subtreeSize = 0,
    nameColumnWidth = 420,
    onSelect,
    onToggleCollapse,
    onEventClick,
  }: Props = $props()

  // Calculate span position and width as percentages (reactive)
  const spanStartNs = $derived(
    BigInt(span.startTimeUnixNano) - BigInt(traceStartNano),
  )
  const spanDurationNs = $derived(
    BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
  )

  const leftPercent = $derived(
    Number((spanStartNs * 10000n) / traceDurationNs) / 100,
  )
  const widthPercent = $derived(
    Number((spanDurationNs * 10000n) / traceDurationNs) / 100,
  )

  const serviceName = $derived(
    (span.resource['service.name'] as string) || 'unknown',
  )
  // themeStore.current is a reactive dependency — color updates on theme toggle
  const serviceColor = $derived(
    getServiceColor(serviceName, themeStore.current),
  )
  const hasError = $derived(span.status.code === 2)

  const spanKind = $derived(
    (() => {
      const label = spanKindLabel(span.kind)
      return label === 'UNKNOWN' || label === 'UNSPECIFIED' ? null : label
    })(),
  )

  // Calculate event positions on timeline
  const eventPositions = $derived(
    span.events.map((event) => {
      const eventOffsetNs =
        BigInt(event.timeUnixNano) - BigInt(span.startTimeUnixNano)
      const positionPercent =
        Number((eventOffsetNs * 10000n) / spanDurationNs) / 100
      return {
        name: event.name,
        position: Math.max(0, Math.min(100, positionPercent)),
      }
    }),
  )

  function handleEventClick(eventIndex: number, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation()
    if (onEventClick) {
      onEventClick(eventIndex)
    }
  }

  // Badge: show direct child count when expanded, subtree total when collapsed
  const badgeValue = $derived(isCollapsed ? subtreeSize : childCount)
  const badgeText = $derived(badgeValue > 99 ? '99+' : String(badgeValue))

  function handleCollapseToggle(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation()
    if (onToggleCollapse) {
      onToggleCollapse()
    }
    // Blur the button to prevent it from capturing keyboard events
    if (e.target instanceof HTMLElement) {
      e.target.blur()
    }
  }
</script>

<div
  class="waterfall-row"
  class:selected={isSelected}
  class:highlighted={isHighlighted}
  class:error={hasError}
  style:grid-template-columns="{nameColumnWidth}px 1fr"
  onclick={onSelect}
  onkeydown={() => {
    // Keyboard navigation handled at container level
  }}
  role="row"
  aria-selected={isSelected}
  tabindex="-1"
>
  <!-- Left: Span name with indentation -->
  <div class="span-info" style="padding-left: {depth * 20}px">
    <div class="span-name">
      {#if !hasChildren}
        <span class="child-badge child-badge-leaf" aria-hidden="true"></span>
      {:else}
        <button
          class="child-badge"
          class:badge-collapsed={isCollapsed}
          onclick={handleCollapseToggle}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleCollapseToggle(e)
            }
          }}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!isCollapsed}
          title={`${badgeValue} ${isCollapsed ? 'spans hidden' : 'direct children'}\n${isCollapsed ? 'Expand: → Right • Toggle: Enter' : 'Collapse: ← Left • Toggle: Enter'}`}
          tabindex="-1">{badgeText}</button
        >
      {/if}
      <span class="span-name-text" title={span.name}>{span.name}</span>
    </div>
    <div class="span-meta">
      <ServiceBadge {serviceName} />
      {#if spanKind}
        <span class="span-kind" title="Span kind">{spanKind}</span>
      {/if}
    </div>
  </div>

  <!-- Right: Timeline bar -->
  <div class="timeline">
    <div
      class="timeline-bar"
      class:error-bar={hasError}
      style="left: {leftPercent}%; width: {Math.max(
        widthPercent,
        0.5,
      )}%; background: {serviceColor}"
      title={formatDuration(span.startTimeUnixNano, span.endTimeUnixNano)}
    >
      <span class="duration-label">
        {formatDuration(span.startTimeUnixNano, span.endTimeUnixNano)}
      </span>

      <!-- Event markers -->
      {#each eventPositions as event, index}
        <div
          class="event-marker"
          style="left: {event.position}%"
          title={event.name}
          onclick={(e) => handleEventClick(index, e)}
          onkeydown={(e) => e.key === 'Enter' && handleEventClick(index, e)}
          role="button"
          tabindex="0"
        ></div>
      {/each}
    </div>
  </div>
</div>

<style>
  .waterfall-row {
    display: grid;
    grid-template-columns: 420px 1fr; /* overridden by inline style */
    gap: 1rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border-light);
    cursor: pointer;
    transition: background 0.15s ease;
    min-height: 48px;
    align-items: center;
  }

  .waterfall-row:hover {
    background: var(--bg-surface-hover);
  }

  .waterfall-row.selected {
    background: var(--selected-bg);
    border-left: 3px solid var(--selected-border);
    padding-left: calc(0.5rem - 3px);
  }

  .waterfall-row.error {
    background: var(--error-bg-row);
  }

  .waterfall-row.error:hover {
    background: var(--error-bg-row-hover);
  }

  .waterfall-row.highlighted {
    background: var(--highlight-bg);
    border-left: 3px solid var(--highlight-border);
    padding-left: calc(0.5rem - 3px);
  }

  .waterfall-row.highlighted:hover {
    background: var(--highlight-bg-hover);
  }

  .waterfall-row.selected.highlighted {
    background: linear-gradient(
      to right,
      var(--highlight-bg-hover) 0%,
      var(--selected-bg) 8px
    );
    border-left: 3px solid var(--highlight-border);
    box-shadow: inset 3px 0 0 0 var(--selected-border);
  }

  .span-info {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
  }

  .span-name {
    font-weight: 500;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  /* Child count badge — fixed 20×18px, always reserves space */
  .child-badge {
    width: 20px;
    height: 18px;
    flex-shrink: 0;
    font-family: monospace;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.5px;
    overflow: hidden;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    /* outlined style (expanded state) */
    background: transparent;
    border: 1.5px solid var(--collapse-text);
    color: var(--collapse-text);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }

  .child-badge:hover {
    border-color: var(--collapse-text-hover);
    color: var(--collapse-text-hover);
  }

  .child-badge:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* filled style (collapsed state) */
  .child-badge.badge-collapsed {
    background: var(--collapse-text);
    color: var(--bg-surface);
    border-color: var(--collapse-text);
  }

  .child-badge.badge-collapsed:hover {
    background: var(--collapse-text-hover);
    border-color: var(--collapse-text-hover);
  }

  /* Leaf span: empty dashed box — declared after .child-badge so source order wins */
  .child-badge-leaf {
    border: 1.5px dashed var(--collapse-text);
    background: transparent;
    color: transparent;
    cursor: default;
  }

  .child-badge-leaf:hover {
    border: 1.5px dashed var(--collapse-text);
    background: transparent;
    color: transparent;
  }

  .span-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .span-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .span-kind {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 0.6875rem;
  }

  .timeline {
    position: relative;
    height: 28px;
    background: var(--timeline-bg);
    border-radius: 4px;
  }

  .timeline-bar {
    position: absolute;
    height: 100%;
    border-radius: 4px;
    display: flex;
    align-items: center;
    padding: 0 0.5rem;
    transition: opacity 0.15s ease;
    min-width: 2px;
    border: 1px solid rgba(0, 0, 0, 0.12);
  }

  .timeline-bar:hover {
    opacity: 0.85;
  }

  .error-bar {
    background: var(--error-bar) !important;
    border: 2px solid var(--error-bar-border) !important;
    box-shadow: 0 0 0 2px var(--error-bar-ring);
  }

  .duration-label {
    color: var(--badge-text);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Hide duration label if bar is too small */
  .timeline-bar[style*='width: 0.5%'] .duration-label,
  .timeline-bar[style*='width: 1%'] .duration-label {
    display: none;
  }

  /* Event markers (diamonds) */
  .event-marker {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    background: var(--event-color);
    transform: translate(-50%, -50%) rotate(45deg);
    cursor: pointer;
    border: 2px solid var(--event-border);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
    z-index: 10;
  }

  .event-marker:hover {
    transform: translate(-50%, -50%) rotate(45deg) scale(1.3);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .event-marker:focus {
    outline: 2px solid var(--event-color);
    outline-offset: 2px;
  }
</style>
