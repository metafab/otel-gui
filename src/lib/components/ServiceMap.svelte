<script lang="ts">
  import type { ServiceMapData } from "$lib/types";
  import { getServiceColor } from "$lib/utils/colors";
  import {
    layoutGraph,
    type LayoutNode,
    type LayoutEdge,
  } from "$lib/utils/graph";
  import { themeStore } from "$lib/stores/theme.svelte";

  interface Props {
    data: ServiceMapData;
    /** When true, renders a compact read-only version */
    mini?: boolean;
    /** Called with the service name when a node is clicked (global map only) */
    onSelectService?: (name: string) => void;
  }

  const { data, mini = false, onSelectService }: Props = $props();

  const theme = $derived(themeStore.current);

  const layout = $derived(layoutGraph(data.nodes, data.edges));

  // Padding around the graph content
  const PAD = $derived(mini ? 16 : 32);

  const svgWidth = $derived(Math.max(layout.viewWidth + PAD * 2, 200));
  const svgHeight = $derived(
    Math.max(layout.viewHeight + PAD * 2, mini ? 180 : 240),
  );

  // Tooltip state
  let tooltip = $state<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
  }>({ visible: false, x: 0, y: 0, content: "" });

  let hoveredNode = $state<string | null>(null);
  let hoveredEdgeKey = $state<string | null>(null);

  function edgeKey(e: LayoutEdge): string {
    return `${e.source}||${e.target}`;
  }

  function formatMs(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function errorRate(edge: LayoutEdge): string {
    if (edge.callCount === 0) return "0%";
    return `${((edge.errorCount / edge.callCount) * 100).toFixed(1)}%`;
  }

  function nodeLabel(n: LayoutNode): string {
    const label =
      n.serviceName.length > 18
        ? n.serviceName.slice(0, 16) + "…"
        : n.serviceName;
    return label;
  }

  function nodeIcon(n: LayoutNode): string {
    switch (n.nodeType) {
      case "database":
        return "⬡";
      case "messaging":
        return "⬟";
      case "rpc":
        return "⬢";
      default:
        return "";
    }
  }

  function showNodeTooltip(e: MouseEvent, n: LayoutNode) {
    if (mini) return;
    const lines = [
      n.serviceName,
      `Spans: ${n.spanCount}`,
      `Errors: ${n.errorCount}`,
      n.system ? `System: ${n.system}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const rect = (e.currentTarget as SVGElement)
      .closest("svg")!
      .getBoundingClientRect();
    tooltip = {
      visible: true,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
      content: lines,
    };
  }

  function showEdgeTooltip(e: MouseEvent, edge: LayoutEdge) {
    if (mini) return;
    const errPct = errorRate(edge);
    const lines = [
      `${edge.source} → ${edge.target}`,
      `Calls: ${edge.callCount}`,
      `Errors: ${edge.errorCount} (${errPct})`,
      `p50: ${formatMs(edge.p50Ms)}`,
      `p99: ${formatMs(edge.p99Ms)}`,
    ].join("\n");
    const rect = (e.currentTarget as SVGElement)
      .closest("svg")!
      .getBoundingClientRect();
    tooltip = {
      visible: true,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
      content: lines,
    };
  }

  function hideTooltip() {
    tooltip = { ...tooltip, visible: false };
  }

  function handleNodeClick(n: LayoutNode) {
    if (!mini && n.nodeType === "service" && onSelectService) {
      onSelectService(n.serviceName);
    }
  }

  // Stroke width for edges: thicker = more calls, clamped 1.5–4
  function edgeStrokeWidth(edge: LayoutEdge, total: number): number {
    if (total === 0) return 1.5;
    const ratio = edge.callCount / total;
    return Math.max(1.5, Math.min(4, 1.5 + ratio * 10));
  }

  const maxCalls = $derived(
    layout.edges.length > 0
      ? Math.max(...layout.edges.map((e) => e.callCount))
      : 1,
  );
</script>

{#if data.nodes.length === 0}
  <div class="empty-map">
    <p>No service data yet — send traces to see the service map.</p>
  </div>
{:else}
  <div class="service-map-wrap" class:mini>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      viewBox="0 0 {svgWidth} {svgHeight}"
      width={svgWidth}
      height={svgHeight}
      role="img"
      aria-label="Service dependency map"
      onmouseleave={hideTooltip}
    >
      <defs>
        <!-- Default arrowhead -->
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)" />
        </marker>
        <!-- Error arrowhead -->
        <marker
          id="arrow-error"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--error-border)" />
        </marker>
      </defs>

      <g transform="translate({PAD},{PAD})">
        <!-- ── Edges ───────────────────────────────────────────────────── -->
        {#each layout.edges as edge (edgeKey(edge))}
          {@const isError = edge.errorCount > 0}
          {@const isHovered = hoveredEdgeKey === edgeKey(edge)}
          {@const sw = edgeStrokeWidth(edge, maxCalls)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="edge-group"
            onmouseenter={(e) => {
              hoveredEdgeKey = edgeKey(edge);
              showEdgeTooltip(e, edge);
            }}
            onmouseleave={() => {
              hoveredEdgeKey = null;
              hideTooltip();
            }}
          >
            <path
              d={edge.path}
              fill="none"
              stroke={isError ? "var(--error-border)" : "var(--border)"}
              stroke-width={isHovered ? sw + 1.5 : sw}
              stroke-dasharray={isError ? "5,3" : undefined}
              marker-end={isError ? "url(#arrow-error)" : "url(#arrow)"}
              opacity={hoveredNode !== null &&
              hoveredNode !== edge.source &&
              hoveredNode !== edge.target
                ? 0.2
                : 0.8}
            />
            <!-- Invisible wider hit area for hover -->
            <path
              d={edge.path}
              fill="none"
              stroke="transparent"
              stroke-width="12"
            />
            {#if !mini}
              <!-- Edge label: call count + error % + p50 -->
              <text
                x={edge.labelX}
                y={edge.labelY}
                class="edge-label"
                class:error-label={isError}
                opacity={isHovered ? 1 : 0.7}
              >
                {edge.callCount}×
                {#if isError}
                  · {errorRate(edge)} err
                {/if}
                · {formatMs(edge.p50Ms)}
              </text>
            {/if}
          </g>
        {/each}

        <!-- ── Nodes ───────────────────────────────────────────────────── -->
        {#each layout.nodes as node (node.serviceName)}
          {@const color = getServiceColor(node.serviceName, theme)}
          {@const hasError = node.errorCount > 0}
          {@const isHovered = hoveredNode === node.serviceName}
          {@const isService = node.nodeType === "service"}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <g
            class="node-group"
            class:clickable={isService && !mini}
            transform="translate({node.x},{node.y})"
            role={isService && !mini ? "button" : undefined}
            tabindex={isService && !mini ? 0 : undefined}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleNodeClick(node);
            }}
            onmouseenter={(e) => {
              hoveredNode = node.serviceName;
              showNodeTooltip(e, node);
            }}
            onmouseleave={() => {
              hoveredNode = null;
              hideTooltip();
            }}
            onclick={() => handleNodeClick(node)}
          >
            {#if node.nodeType === "database"}
              <!-- Cylinder shape for databases -->
              <ellipse
                cx={node.width / 2}
                cy={10}
                rx={node.width / 2 - 2}
                ry={9}
                fill={color}
                stroke={hasError ? "var(--error-border)" : "var(--border)"}
                stroke-width={isHovered ? 2.5 : 1.5}
              />
              <rect
                x={2}
                y={10}
                width={node.width - 4}
                height={node.height - 14}
                fill={color}
                stroke="none"
              />
              <line
                x1={2}
                y1={node.height - 4}
                x2={node.width - 2}
                y2={node.height - 4}
                stroke={hasError ? "var(--error-border)" : "var(--border)"}
                stroke-width={isHovered ? 2.5 : 1.5}
              />
              <ellipse
                cx={node.width / 2}
                cy={node.height - 4}
                rx={node.width / 2 - 2}
                ry={9}
                fill={color}
                stroke={hasError ? "var(--error-border)" : "var(--border)"}
                stroke-width={isHovered ? 2.5 : 1.5}
              />
            {:else if node.nodeType === "messaging"}
              <!-- Hexagon shape for message queues -->
              {@const w = node.width - 4}
              {@const h = node.height}
              {@const cx = node.width / 2}
              {@const cy = h / 2}
              {@const rx = w / 2}
              {@const ry = h / 2}
              <polygon
                points="{cx - rx},{cy} {cx - rx * 0.5},{cy - ry} {cx +
                  rx * 0.5},{cy - ry} {cx + rx},{cy} {cx + rx * 0.5},{cy +
                  ry} {cx - rx * 0.5},{cy + ry}"
                fill={color}
                stroke={hasError ? "var(--error-border)" : "var(--border)"}
                stroke-width={isHovered ? 2.5 : 1.5}
              />
            {:else}
              <!-- Rounded rect for services -->
              <rect
                width={node.width}
                height={node.height}
                rx={8}
                ry={8}
                fill={color}
                stroke={hasError ? "var(--error-border)" : "var(--border)"}
                stroke-width={isHovered ? 2.5 : 1.5}
              />
            {/if}

            <!-- Service name label -->
            <text
              x={node.width / 2}
              y={mini ? node.height / 2 : node.height / 2 - 8}
              class="node-label"
              class:mini-label={mini}
            >
              {#if !mini && nodeIcon(node)}
                <tspan class="node-icon">{nodeIcon(node)} </tspan>
              {/if}{nodeLabel(node)}
            </text>

            {#if !mini}
              <!-- Span / error counts -->
              <text
                x={node.width / 2}
                y={node.height / 2 + 8}
                class="node-counts"
              >
                {node.spanCount} span{node.spanCount !== 1 ? "s" : ""}
                {#if hasError}
                  · <tspan class="error-count">{node.errorCount} err</tspan>
                {/if}
              </text>
            {/if}
          </g>
        {/each}
      </g>
    </svg>

    <!-- Tooltip (rendered outside SVG for reliable positioning) -->
    {#if tooltip.visible}
      <div class="tooltip" style="left:{tooltip.x}px;top:{tooltip.y}px">
        {#each tooltip.content.split("\n") as line, i}
          <span class:tooltip-title={i === 0}>{line}</span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .service-map-wrap {
    position: relative;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .service-map-wrap.mini {
    border-radius: 6px;
  }

  .empty-map {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    color: var(--text-muted);
    font-size: 0.875rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .empty-map p {
    margin: 0;
  }

  svg {
    display: block;
  }

  .node-group {
    transition: opacity 0.15s ease;
  }

  .node-group.clickable {
    cursor: pointer;
  }

  .node-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--text-primary);
    pointer-events: none;
    user-select: none;
  }

  .mini-label {
    font-size: 0.65rem;
  }

  .node-icon {
    font-size: 0.65rem;
  }

  .node-counts {
    font-size: 0.6rem;
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--text-secondary);
    pointer-events: none;
    user-select: none;
  }

  .error-count {
    fill: var(--error-text);
    font-weight: 600;
  }

  .edge-label {
    font-size: 0.6rem;
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--text-secondary);
    pointer-events: none;
    user-select: none;
  }

  .error-label {
    fill: var(--error-text);
  }

  .tooltip {
    position: absolute;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.75rem;
    line-height: 1.6;
    color: var(--text-primary);
    pointer-events: none;
    white-space: pre;
    box-shadow: var(--shadow);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .tooltip-title {
    font-weight: 600;
    color: var(--text-primary);
  }
</style>
