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
    onSelect: () => void;
  }

  let {
    span,
    depth,
    traceStartNano,
    traceDurationNs,
    isSelected,
    onSelect,
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
</script>

<div
  class="waterfall-row"
  class:selected={isSelected}
  class:error={hasError}
  onclick={onSelect}
  onkeydown={(e) => e.key === "Enter" && onSelect()}
  role="button"
  tabindex="0"
>
  <!-- Left: Span name with indentation -->
  <div class="span-info" style="padding-left: {depth * 20}px">
    <div class="span-name" title={span.name}>
      {span.name}
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
</style>
