<script lang="ts">
  import type { StoredSpan } from "$lib/types";
  import { formatDuration } from "$lib/utils/time";
  import { getServiceColor } from "$lib/utils/colors";
  import { spanKindLabel, statusLabel } from "$lib/utils/spans";

  interface Props {
    span: StoredSpan;
    depth: number;
    traceStartNano: string;
    traceDurationNs: bigint;
    isSelected: boolean;
    isHighlighted?: boolean;
    hasChildren?: boolean;
    isCollapsed?: boolean;
    onSelect: () => void;
    onToggleCollapse?: () => void;
    onEventClick?: (eventIndex: number) => void;
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
    onSelect,
    onToggleCollapse,
    onEventClick,
  }: Props = $props();

  // Calculate span position and width as percentages (reactive)
  const spanStartNs = $derived(
    BigInt(span.startTimeUnixNano) - BigInt(traceStartNano),
  );
  const spanDurationNs = $derived(
    BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
  );

  const leftPercent = $derived(
    Number((spanStartNs * 10000n) / traceDurationNs) / 100,
  );
  const widthPercent = $derived(
    Number((spanDurationNs * 10000n) / traceDurationNs) / 100,
  );

  const serviceName = $derived(
    (span.resource["service.name"] as string) || "unknown",
  );
  const serviceColor = $derived(getServiceColor(serviceName));
  const hasError = $derived(span.status.code === 2);

  // Calculate event positions on timeline
  const eventPositions = $derived(
    span.events.map((event) => {
      const eventOffsetNs =
        BigInt(event.timeUnixNano) - BigInt(span.startTimeUnixNano);
      const positionPercent =
        Number((eventOffsetNs * 10000n) / spanDurationNs) / 100;
      return {
        name: event.name,
        position: Math.max(0, Math.min(100, positionPercent)),
      };
    }),
  );

  function handleEventClick(eventIndex: number, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    if (onEventClick) {
      onEventClick(eventIndex);
    }
  }

  function handleCollapseToggle(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    if (onToggleCollapse) {
      onToggleCollapse();
    }
  }
</script>

<div
  class="waterfall-row"
  class:selected={isSelected}
  class:highlighted={isHighlighted}
  class:error={hasError}
  onclick={onSelect}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }}
  role="row"
  aria-selected={isSelected}
  tabindex="-1"
>
  <!-- Left: Span name with indentation -->
  <div class="span-info" style="padding-left: {depth * 20}px">
    <div class="span-name" title={span.name}>
      {#if hasChildren}
        <button
          class="collapse-toggle"
          onclick={handleCollapseToggle}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleCollapseToggle(e);
            }
          }}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          aria-expanded={!isCollapsed}
          tabindex="-1"
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
      {/if}
      <span class="span-name-text">{span.name}</span>
    </div>
    <div class="span-meta">
      <span class="service-badge" style="background: {serviceColor}"
        >{serviceName}</span
      >
      <span class="span-kind">{spanKindLabel(span.kind)}</span>
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
          onkeydown={(e) => e.key === "Enter" && handleEventClick(index, e)}
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
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    padding: 0.5rem;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
    transition: background 0.15s ease;
    min-height: 48px;
    align-items: center;
  }

  .waterfall-row:hover {
    background: #f9f9f9;
  }

  .waterfall-row.selected {
    background: #e3f2fd;
    border-left: 3px solid #1976d2;
    padding-left: calc(0.5rem - 3px);
  }

  .waterfall-row.error {
    background: #fff3f3;
  }

  .waterfall-row.error:hover {
    background: #ffebeb;
  }

  .waterfall-row.highlighted {
    background: #fff9e6;
    border-left: 3px solid #ffa726;
    padding-left: calc(0.5rem - 3px);
  }

  .waterfall-row.highlighted:hover {
    background: #fff3d9;
  }

  .waterfall-row.selected.highlighted {
    /* Blend of selected blue and highlighted yellow */
    background: linear-gradient(to right, #fff3d9 0%, #e3f2fd 8px);
    /* Use orange border to show search match */
    border-left: 3px solid #ffa726;
    /* Add a subtle blue secondary indicator */
    box-shadow: inset 3px 0 0 0 #1976d2;
  }

  .span-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
    gap: 0.25rem;
  }

  .collapse-toggle {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    flex-shrink: 0;
    transition: color 0.15s ease;
  }

  .collapse-toggle:hover {
    color: #333;
  }

  .collapse-toggle:focus {
    outline: 2px solid #1976d2;
    outline-offset: 2px;
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
  }

  .service-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    color: white;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.6875rem;
  }

  .span-kind {
    color: #999;
    text-transform: uppercase;
    font-size: 0.6875rem;
  }

  .timeline {
    position: relative;
    height: 28px;
    background: #f5f5f5;
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
  }

  .timeline-bar:hover {
    opacity: 0.85;
  }

  .error-bar {
    border: 2px solid #c62828;
    box-shadow: 0 0 0 1px rgba(198, 40, 40, 0.2);
  }

  .duration-label {
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Hide duration label if bar is too small */
  .timeline-bar[style*="width: 0.5%"] .duration-label,
  .timeline-bar[style*="width: 1%"] .duration-label {
    display: none;
  }

  /* Event markers (diamonds) */
  .event-marker {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    background: #ff9800;
    transform: translate(-50%, -50%) rotate(45deg);
    cursor: pointer;
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
    z-index: 10;
  }

  .event-marker:hover {
    transform: translate(-50%, -50%) rotate(45deg) scale(1.3);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .event-marker:focus {
    outline: 2px solid #ff9800;
    outline-offset: 2px;
  }
</style>
