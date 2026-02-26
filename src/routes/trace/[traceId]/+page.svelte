<script lang="ts">
  import { page } from "$app/stores";
  import { replaceState } from "$app/navigation";
  import { onMount } from "svelte";
  import { traceStore } from "$lib/stores/traces.svelte";
  import {
    buildSpanTree,
    flattenSpanTree,
    spanKindLabel,
    statusLabel,
  } from "$lib/utils/spans";
  import {
    formatDuration,
    formatTimestamp,
    formatTimestampLocal,
    formatRelativeTime,
  } from "$lib/utils/time";
  import WaterfallRow from "$lib/components/WaterfallRow.svelte";
  import AttributeItem from "$lib/components/AttributeItem.svelte";
  import ServiceMap from "$lib/components/ServiceMap.svelte";
  import { isInputFocused, isMac } from "$lib/utils/keyboard";
  import KeyboardShortcutsHelp from "$lib/components/KeyboardShortcutsHelp.svelte";
  import ChevronIcon from "$lib/components/ChevronIcon.svelte";
  import type { StoredTrace, SpanTreeNode, ServiceMapData } from "$lib/types";

  // Get trace ID from URL
  const traceId = $derived($page.params.traceId);
  const spanIdFromUrl = $derived($page.url.searchParams.get("spanId"));

  // Page title with shortened trace ID
  const pageTitle = $derived(
    traceId ? `otel-gui – Trace ${traceId.slice(0, 8)}` : "otel-gui – Trace",
  );

  // Local state
  let trace = $state<StoredTrace | null>(null);
  let spanTreeRoot = $state<SpanTreeNode[]>([]); // Tree structure with collapse state
  let spanTree = $state<SpanTreeNode[]>([]); // Flattened view for rendering
  let selectedSpanId = $state<string | null>(null);
  let selectedEventIndex = $state<number | null>(null);
  let attributeFilter = $state<string>("");
  let resourceFilter = $state<string>("");
  let scopeFilter = $state<string>("");
  let resourceCollapsed = $state<boolean>(true);
  let scopeCollapsed = $state<boolean>(true);
  let spanSearchQuery = $state<string>("");
  let currentMatchIndex = $state<number>(0);
  let currentErrorIndex = $state<number>(-1);
  let isLoading = $state<boolean>(true);
  let error = $state<string | null>(null);
  let showTraceDetails = $state<boolean>(true);
  let showSpanDetails = $state<boolean>(true);
  let isMaximized = $derived(!showTraceDetails && !showSpanDetails);
  let waterfallContainer = $state<HTMLDivElement | null>(null);
  let sidebarWidth = $state<number>(400);
  let isDraggingSplitter = $state<boolean>(false);
  let contentGridElement = $state<HTMLDivElement | null>(null);
  let nameColumnWidth = $state<number>(420);
  let isColumnSplitterDragging = $state<boolean>(false);
  let fullscreenAttr = $state<{ key: string; value: string } | null>(null);
  let fullscreenCopied = $state(false);
  let traceIdCopied = $state(false);

  // Mini service map
  let showMiniMap = $state(false);
  let miniMapData = $state<ServiceMapData | null>(null);
  let miniMapLoading = $state(false);
  let spanSearchInputEl = $state<HTMLInputElement | null>(null);
  let showShortcuts = $state(false);

  async function copyTraceId() {
    if (!trace) return;
    try {
      await navigator.clipboard.writeText(trace.traceId);
      traceIdCopied = true;
      setTimeout(() => {
        traceIdCopied = false;
      }, 1500);
    } catch {
      // ignore
    }
  }

  function openFullscreen(key: string, formatted: string) {
    fullscreenAttr = { key, value: formatted };
    fullscreenCopied = false;
  }

  function closeFullscreen() {
    fullscreenAttr = null;
    fullscreenCopied = false;
  }

  async function copyFullscreenValue() {
    if (!fullscreenAttr) return;
    try {
      await navigator.clipboard.writeText(fullscreenAttr.value);
      fullscreenCopied = true;
      setTimeout(() => {
        fullscreenCopied = false;
      }, 1500);
    } catch {
      // ignore
    }
  }

  function autoFocus(node: HTMLElement) {
    node.focus();
  }

  // Derived: trace duration for waterfall calculation
  const traceDurationNs = $derived(
    trace
      ? BigInt(trace.endTimeUnixNano) - BigInt(trace.startTimeUnixNano)
      : 0n,
  );
  const traceDuration = $derived(
    trace ? formatDuration(trace.startTimeUnixNano, trace.endTimeUnixNano) : "",
  );

  // Derived: unique service count and max tree depth
  const serviceCount = $derived(
    trace
      ? new Set(
          Array.from(trace.spans.values()).map(
            (s) => (s.resource["service.name"] as string) || "unknown",
          ),
        ).size
      : 0,
  );

  const maxDepth = $derived(
    spanTree.length > 0 ? Math.max(...spanTree.map((n) => n.depth)) + 1 : 0,
  );

  // Span search matching
  const matchingSpanIds = $derived.by(() => {
    if (!spanSearchQuery.trim() || !trace) return new Set<string>();

    const query = spanSearchQuery.toLowerCase();
    const matches = new Set<string>();

    for (const node of spanTree) {
      const span = node.span;
      const serviceName =
        (span.resource["service.name"] as string) || "unknown";

      // Match on span name
      if (span.name.toLowerCase().includes(query)) {
        matches.add(span.spanId);
        continue;
      }

      // Match on service name
      if (serviceName.toLowerCase().includes(query)) {
        matches.add(span.spanId);
        continue;
      }

      // Match on span kind
      if (spanKindLabel(span.kind).toLowerCase().includes(query)) {
        matches.add(span.spanId);
        continue;
      }

      // Match on attribute keys or values
      for (const [key, value] of Object.entries(span.attributes)) {
        if (
          key.toLowerCase().includes(query) ||
          JSON.stringify(value).toLowerCase().includes(query)
        ) {
          matches.add(span.spanId);
          break;
        }
      }

      // Match on event names or event attributes
      for (const event of span.events) {
        // Match on event name
        if (event.name.toLowerCase().includes(query)) {
          matches.add(span.spanId);
          break;
        }

        // Match on event attribute keys or values
        for (const [key, value] of Object.entries(event.attributes)) {
          if (
            key.toLowerCase().includes(query) ||
            JSON.stringify(value).toLowerCase().includes(query)
          ) {
            matches.add(span.spanId);
            break;
          }
        }

        // If we already matched this span via event, stop checking more events
        if (matches.has(span.spanId)) {
          break;
        }
      }
    }

    return matches;
  });

  const matchingSpans = $derived(
    spanTree.filter((node) => matchingSpanIds.has(node.span.spanId)),
  );

  const matchCount = $derived(matchingSpanIds.size);

  // Error span tracking
  // errorSpans: visible error spans only (used for navigation)
  const errorSpans = $derived(
    spanTree.filter((node) => node.span.status.code === 2),
  );

  const errorCount = $derived(errorSpans.length);

  // Helper function to count all error spans recursively (including collapsed)
  function countAllErrorSpans(nodes: SpanTreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.span.status.code === 2) {
        count++;
      }
      if (node.children.length > 0) {
        count += countAllErrorSpans(node.children);
      }
    }
    return count;
  }

  // totalErrorCount: all error spans in the trace (regardless of collapse state)
  const totalErrorCount = $derived(countAllErrorSpans(spanTreeRoot));

  // Reset current match index when search changes
  $effect(() => {
    if (spanSearchQuery) {
      currentMatchIndex = 0;
    }
  });

  // Reset current error index when trace changes
  $effect(() => {
    if (errorCount > 0) {
      currentErrorIndex = -1;
    }
  });

  // Update currentErrorIndex when selectedSpanId changes
  $effect(() => {
    if (!selectedSpanId) {
      currentErrorIndex = -1;
      return;
    }

    // Find the index of the selected span in errorSpans
    const errorIndex = errorSpans.findIndex(
      (node) => node.span.spanId === selectedSpanId,
    );

    // If selected span is an error span, update currentErrorIndex
    // Otherwise, set it to -1
    currentErrorIndex = errorIndex;
  });

  // Load trace data on mount
  onMount(async () => {
    await loadTrace();
  });

  // Reload trace when URL changes (for hyperlink navigation)
  $effect(() => {
    // Watch for changes in traceId or spanIdFromUrl
    if (traceId) {
      loadTrace();
    }
  });

  // Add mouse event listeners for splitter dragging
  $effect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  });

  // Handle Escape in capture phase so it fires before browser-native input
  // handling (Chrome resets/blurs inputs on Esc before bubbling; Firefox
  // consumes Esc at the accessibility layer for certain roles) and before
  // any element-level keydown handlers.
  $effect(() => {
    if (typeof document === "undefined") return;

    function handleEscCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (fullscreenAttr) return; // fullscreen modal handles its own Esc

      if (showShortcuts) {
        e.preventDefault();
        showShortcuts = false;
        return;
      }

      // If the span search is focused: clear it and move focus to waterfall.
      // Any other focused element (including filter inputs, buttons, waterfall): go back.
      if (spanSearchInputEl && document.activeElement === spanSearchInputEl) {
        e.preventDefault();
        spanSearchQuery = "";
        spanSearchInputEl.blur();
        waterfallContainer?.focus();
      } else {
        e.preventDefault();
        handleBack();
      }
    }

    document.addEventListener("keydown", handleEscCapture, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleEscCapture, {
        capture: true,
      });
  });

  // Auto-restore span details panel when a span is selected.
  // NOTE: must NOT read showSpanDetails here — doing so would make it a
  // reactive dependency, causing the effect to re-run (and immediately
  // undo) whenever the user clicks "Hide Span Details".
  $effect(() => {
    if (selectedSpanId) {
      showSpanDetails = true;
    }
  });

  // Auto-focus waterfall container when trace loads
  $effect(() => {
    if (waterfallContainer && trace && selectedSpanId && !isLoading) {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        waterfallContainer?.focus();
      }, 0);
    }
  });

  // Auto-scroll selected span row into view
  $effect(() => {
    if (!selectedSpanId || !waterfallContainer) return;
    // Run after the DOM has re-rendered with the new selection
    requestAnimationFrame(() => {
      const row = waterfallContainer?.querySelector(
        `[data-span-id="${selectedSpanId}"]`,
      );
      row?.scrollIntoView({ block: "nearest" });
    });
  });

  async function loadTrace() {
    if (!traceId) {
      error = "No trace ID provided";
      isLoading = false;
      return;
    }
    isLoading = true;
    error = null;
    try {
      const data = await traceStore.fetchTrace(traceId);
      if (data) {
        // API returns spans as Record, convert to Map for type compatibility
        const spansMap = new Map<string, any>();
        const spansArray = [];
        for (const [id, span] of Object.entries(data.spans)) {
          spansMap.set(id, span);
          spansArray.push(span);
        }
        trace = { ...data, spans: spansMap };
        // Build tree and flatten for rendering
        spanTreeRoot = buildSpanTree(spansArray);
        spanTree = flattenSpanTree(spanTreeRoot);

        // Auto-select span from URL query parameter if present, otherwise select root span
        if (spanIdFromUrl && spansMap.has(spanIdFromUrl)) {
          selectedSpanId = spanIdFromUrl;
        } else if (spanTreeRoot.length > 0) {
          // Preselect the root span (first node in tree)
          selectedSpanId = spanTreeRoot[0].span.spanId;
        } else {
          selectedSpanId = null;
        }
      } else {
        error = "Trace not found";
      }
      // Load mini service map for this trace
      miniMapLoading = true;
      try {
        const mapRes = await fetch(`/api/service-map?traceId=${traceId}`);
        if (mapRes.ok) {
          miniMapData = await mapRes.json();
        }
      } catch {
        // silently ignore map errors
      } finally {
        miniMapLoading = false;
      }
    } catch (err) {
      error =
        err instanceof Error ? err.message : "Unknown error loading trace";
    } finally {
      isLoading = false;
    }
  }

  // Splitter drag handlers - sidebar (right panel)
  function handleSplitterMouseDown(e: MouseEvent) {
    isDraggingSplitter = true;
    document.body.classList.add("dragging-splitter");
    e.preventDefault();
  }

  // Column splitter drag handler - name column vs timeline
  function handleColumnSplitterMouseDown(e: MouseEvent) {
    isColumnSplitterDragging = true;
    document.body.classList.add("dragging-splitter");
    e.preventDefault();
  }

  function handleMouseMove(e: MouseEvent) {
    if (isDraggingSplitter && contentGridElement) {
      const gridRect = contentGridElement.getBoundingClientRect();
      const newWidth = gridRect.right - e.clientX;
      // Constrain: sidebar min 200px, timeline (left side) min 200px
      const maxSidebar = gridRect.width - 8 - 200;
      sidebarWidth = Math.max(200, Math.min(maxSidebar, newWidth));
    }

    if (isColumnSplitterDragging && waterfallContainer) {
      const rect = waterfallContainer.getBoundingClientRect();
      // 20px indicator column + 8px left padding of the row
      const newWidth = e.clientX - rect.left - 20 - 8;
      // Min 120px, max: leave at least 200px for the timeline
      const maxNameCol = rect.width - 20 - 16 - 200;
      nameColumnWidth = Math.max(120, Math.min(maxNameCol, newWidth));
    }
  }

  function handleMouseUp() {
    isDraggingSplitter = false;
    isColumnSplitterDragging = false;
    document.body.classList.remove("dragging-splitter");
  }

  // Focus restoration for header buttons
  let previousFocus: Element | null = null;

  function captureWaterfallFocus() {
    previousFocus = document.activeElement;
  }

  function restoreWaterfallFocus() {
    const target = previousFocus;
    if (target && target !== document.body) {
      requestAnimationFrame(() => (target as HTMLElement).focus?.());
    }
  }

  function handleSpanSelect(spanId: string) {
    selectedSpanId = spanId;
    showSpanDetails = true;
    selectedEventIndex = null; // Clear event selection when selecting a different span
    attributeFilter = ""; // Clear attribute filter when selecting a different span
    resourceFilter = "";
    scopeFilter = "";
    // Update URL to include selected span (for bookmarking/sharing)
    const url = new URL(window.location.href);
    url.searchParams.set("spanId", spanId);
    replaceState(url, {});
  }

  function handleEventClick(spanId: string, eventIndex: number) {
    // Select the span if not already selected
    if (selectedSpanId !== spanId) {
      selectedSpanId = spanId;
    }
    selectedEventIndex = eventIndex;

    // Scroll to the event in the sidebar
    setTimeout(() => {
      const eventElement = document.getElementById(`event-${eventIndex}`);
      if (eventElement) {
        eventElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  }

  function handleBack() {
    window.location.href = "/";
  }

  function handleNextMatch() {
    if (matchCount === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % matchCount;
    const matchedSpan = matchingSpans[currentMatchIndex];
    if (matchedSpan) {
      handleSpanSelect(matchedSpan.span.spanId);
    }
  }

  function handlePreviousMatch() {
    if (matchCount === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + matchCount) % matchCount;
    const matchedSpan = matchingSpans[currentMatchIndex];
    if (matchedSpan) {
      handleSpanSelect(matchedSpan.span.spanId);
    }
  }

  function handleNextError() {
    if (errorCount === 0) return;
    if (currentErrorIndex === -1) {
      currentErrorIndex = 0;
    } else {
      currentErrorIndex = (currentErrorIndex + 1) % errorCount;
    }
    const errorSpan = errorSpans[currentErrorIndex];
    if (errorSpan) {
      handleSpanSelect(errorSpan.span.spanId);
    }
  }

  function handlePreviousError() {
    if (errorCount === 0) return;
    if (currentErrorIndex === -1) {
      currentErrorIndex = errorCount - 1;
    } else {
      currentErrorIndex = (currentErrorIndex - 1 + errorCount) % errorCount;
    }
    const errorSpan = errorSpans[currentErrorIndex];
    if (errorSpan) {
      handleSpanSelect(errorSpan.span.spanId);
    }
  }

  // Toggle collapse/expand for a span node
  function toggleNodeCollapse(spanId: string) {
    const node = findNode(spanId);
    if (!node) return;

    const wasCollapsed = node.collapsed;
    node.collapsed = !node.collapsed;

    // If collapsing and selected span is a descendant, select this node
    if (
      !wasCollapsed &&
      selectedSpanId &&
      isDescendantOf(selectedSpanId, node)
    ) {
      selectedSpanId = spanId;
    }

    spanTree = flattenSpanTree(spanTreeRoot);

    // Refocus container after toggle to maintain keyboard navigation
    if (waterfallContainer) {
      waterfallContainer.focus();
    }
  }

  // Set collapse state for a span node
  function setNodeCollapse(spanId: string, collapsed: boolean) {
    const node = findNode(spanId);
    if (!node) return;

    const wasCollapsed = node.collapsed;
    node.collapsed = collapsed;

    // If collapsing and selected span is a descendant, select this node
    if (
      collapsed &&
      !wasCollapsed &&
      selectedSpanId &&
      isDescendantOf(selectedSpanId, node)
    ) {
      selectedSpanId = spanId;
    }

    spanTree = flattenSpanTree(spanTreeRoot);

    // Refocus container after collapse state change to maintain keyboard navigation
    if (waterfallContainer) {
      waterfallContainer.focus();
    }
  }

  // Find node in tree by spanId
  function findNode(
    spanId: string,
    nodes: SpanTreeNode[] = spanTreeRoot,
  ): SpanTreeNode | null {
    for (const node of nodes) {
      if (node.span.spanId === spanId) {
        return node;
      }
      const found = findNode(spanId, node.children);
      if (found) {
        return found;
      }
    }
    return null;
  }

  // Check if a span is a descendant of another span
  function isDescendantOf(
    descendantId: string,
    ancestorNode: SpanTreeNode,
  ): boolean {
    for (const child of ancestorNode.children) {
      if (child.span.spanId === descendantId) {
        return true;
      }
      if (isDescendantOf(descendantId, child)) {
        return true;
      }
    }
    return false;
  }

  // Keyboard navigation handler
  function handleWaterfallKeydown(e: KeyboardEvent) {
    // Esc is handled by the capture-phase listener above; skip it here to
    // avoid double-firing.
    if (e.key === "Escape") return;

    if (!selectedSpanId || spanTree.length === 0) return;

    const currentIndex = spanTree.findIndex(
      (node) => node.span.spanId === selectedSpanId,
    );
    if (currentIndex === -1) return;

    const currentNode = findNode(selectedSpanId);
    if (!currentNode) return;

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (currentIndex > 0) {
          handleSpanSelect(spanTree[currentIndex - 1].span.spanId);
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (currentIndex < spanTree.length - 1) {
          handleSpanSelect(spanTree[currentIndex + 1].span.spanId);
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        if (currentNode.children.length > 0 && !currentNode.collapsed) {
          setNodeCollapse(selectedSpanId, true);
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        if (currentNode.children.length > 0 && currentNode.collapsed) {
          setNodeCollapse(selectedSpanId, false);
        }
        break;

      case "Enter":
        e.preventDefault();
        if (currentNode.children.length > 0) {
          toggleNodeCollapse(selectedSpanId);
        }
        break;
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Belt-and-suspenders: fullscreen modal handles Escape itself via stopPropagation
    if (fullscreenAttr) return;

    // '/' focuses span search (only when not in an input)
    if (e.key === "/" && !isInputFocused()) {
      e.preventDefault();
      spanSearchInputEl?.focus();
      return;
    }

    // Escape is handled by the capture-phase $effect listener; skip here.

    // n: next search match
    if (e.key === "n" && !e.shiftKey && !isInputFocused() && matchCount > 0) {
      e.preventDefault();
      handleNextMatch();
      return;
    }

    // Shift+N: previous search match
    if (e.key === "N" && e.shiftKey && !isInputFocused() && matchCount > 0) {
      e.preventDefault();
      handlePreviousMatch();
      return;
    }

    // e: next error span
    if (e.key === "e" && !e.shiftKey && !isInputFocused() && errorCount > 0) {
      e.preventDefault();
      handleNextError();
      return;
    }

    // Shift+E: previous error span
    if (e.key === "E" && e.shiftKey && !isInputFocused() && errorCount > 0) {
      e.preventDefault();
      handlePreviousError();
      return;
    }

    // 'm': toggle mini service map
    if (e.key === "m" && !isInputFocused()) {
      e.preventDefault();
      showMiniMap = !showMiniMap;
      return;
    }
    // '?': toggle shortcuts help
    if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      showShortcuts = !showShortcuts;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="trace-detail">
  <header class="header">
    <button class="back-button" onclick={handleBack}>← Back to Traces</button>
    {#if trace}
      <div class="view-controls">
        <button
          class="toggle-button"
          onpointerdown={captureWaterfallFocus}
          onclick={() => {
            showTraceDetails = !showTraceDetails;
            restoreWaterfallFocus();
          }}
          title={showTraceDetails ? "Hide trace details" : "Show trace details"}
        >
          {showTraceDetails ? "Hide" : "Show"} Trace Details
        </button>
        <button
          class="toggle-button"
          onpointerdown={captureWaterfallFocus}
          onclick={() => {
            showSpanDetails = !showSpanDetails;
            restoreWaterfallFocus();
          }}
          title={showSpanDetails ? "Hide span details" : "Show span details"}
        >
          {showSpanDetails ? "Hide" : "Show"} Span Details
        </button>
        {#if !isMaximized}
          <button
            class="toggle-button maximize-button"
            onpointerdown={captureWaterfallFocus}
            onclick={() => {
              showTraceDetails = false;
              showSpanDetails = false;
              restoreWaterfallFocus();
            }}
            title="Maximize timeline"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              style="vertical-align: -1px; margin-right: 5px;"
            >
              <!-- top-left arrow -->
              <polyline
                points="5,1 1,1 1,5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- bottom-right arrow -->
              <polyline
                points="9,13 13,13 13,9"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- diagonal line -->
              <line
                x1="1.5"
                y1="1.5"
                x2="12.5"
                y2="12.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>Maximize
          </button>
        {/if}
      </div>
      <button
        class="shortcut-help-btn"
        onclick={() => (showShortcuts = !showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts">?</button
      >
    {/if}
  </header>

  {#if isLoading}
    <div class="loading">Loading trace...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if trace}
    <div class="trace-container">
      <!-- Trace Identification Section -->
      {#if showTraceDetails}
        <section class="trace-identification">
          <div class="trace-id-row">
            <h2>Trace {trace.traceId}</h2>
            <button
              class="trace-id-copy-btn"
              class:copied={traceIdCopied}
              onclick={copyTraceId}
              title="Copy trace ID"
              aria-label="Copy trace ID"
            >
              {#if traceIdCopied}
                <svg
                  width="13"
                  height="13"
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
              {:else}
                <svg
                  width="13"
                  height="13"
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
              {/if}
            </button>
          </div>
          <div class="trace-meta">
            <span class="service">{trace.serviceName}</span>
            <span class="separator">•</span>
            <span class="root-span">{trace.rootSpanName}</span>
            <span class="separator">•</span>
            <span class="spans"
              >{trace.spanCount} span{trace.spanCount !== 1 ? "s" : ""}</span
            >
            <span class="separator">•</span>
            <span class="services"
              >{serviceCount} service{serviceCount !== 1 ? "s" : ""}</span
            >
            <span class="separator">•</span>
            <span class="depth">depth {maxDepth}</span>
            {#if trace.hasError}
              <span class="separator">•</span>
              <span class="error-badge">ERROR</span>
            {/if}
          </div>
          <div class="trace-timestamps">
            <div class="timestamp-item">
              <span class="timestamp-label">Started:</span>
              <span
                class="timestamp-value"
                title={formatTimestamp(trace.startTimeUnixNano)}
                >{formatTimestampLocal(trace.startTimeUnixNano)}</span
              >
            </div>
            <div class="timestamp-item">
              <span class="timestamp-label">Ended:</span>
              <span
                class="timestamp-value"
                title={formatTimestamp(trace.endTimeUnixNano)}
                >{formatTimestampLocal(trace.endTimeUnixNano)}</span
              >
            </div>
            <div class="timestamp-item">
              <span class="timestamp-label">Duration:</span>
              <span class="timestamp-value">{traceDuration}</span>
            </div>
          </div>

          <!-- Mini Service Map -->
          {#if miniMapData && (miniMapData.nodes.length > 1 || miniMapData.edges.length > 0)}
            <div class="mini-map-section">
              <button
                class="mini-map-toggle"
                onclick={() => (showMiniMap = !showMiniMap)}
                aria-expanded={showMiniMap}
              >
                <ChevronIcon expanded={showMiniMap} />
                Service Map
                <span class="mini-map-count"
                  >{miniMapData.nodes.length} service{miniMapData.nodes
                    .length !== 1
                    ? "s"
                    : ""} · {miniMapData.edges.length} edge{miniMapData.edges
                    .length !== 1
                    ? "s"
                    : ""}</span
                >
              </button>
              {#if showMiniMap}
                <div class="mini-map-wrap">
                  {#if miniMapLoading}
                    <div class="mini-map-loading">Loading…</div>
                  {:else}
                    <ServiceMap data={miniMapData} mini={true} />
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Main Content Grid -->
      <div
        class="content-grid"
        class:full-width={!showSpanDetails}
        bind:this={contentGridElement}
        style:grid-template-columns={showSpanDetails
          ? `1fr 8px ${sidebarWidth}px`
          : "1fr"}
      >
        <!-- Waterfall Section (Left) -->
        <section class="waterfall-section">
          <div class="waterfall-header">
            <h3>Timeline</h3>
            <div class="header-controls">
              {#if totalErrorCount > 0}
                <div class="error-navigation">
                  <span class="error-badge-nav"
                    >Spans with errors: {totalErrorCount}</span
                  >
                  {#if errorCount > 0}
                    <button
                      onclick={handlePreviousError}
                      class="nav-button"
                      title="Previous error"
                    >
                      ↑
                    </button>
                    <button
                      onclick={handleNextError}
                      class="nav-button"
                      title="Next error"
                    >
                      ↓
                    </button>
                    <span class="position-indicator"
                      >{currentErrorIndex === -1
                        ? 0
                        : currentErrorIndex + 1}/{errorCount}</span
                    >
                  {/if}
                </div>
              {/if}
              <div class="search-controls">
                <input
                  id="span-search"
                  type="text"
                  bind:value={spanSearchQuery}
                  bind:this={spanSearchInputEl}
                  placeholder="Search spans..."
                  class="span-search-input"
                  onkeydown={(e) => {
                    if (e.key === "Enter" && matchCount > 0) {
                      e.preventDefault();
                      e.shiftKey ? handlePreviousMatch() : handleNextMatch();
                    }
                  }}
                />
                {#if matchCount > 0}
                  <div class="search-navigation">
                    <button
                      onclick={handlePreviousMatch}
                      class="nav-button"
                      title="Previous match"
                    >
                      ↑
                    </button>
                    <button
                      onclick={handleNextMatch}
                      class="nav-button"
                      title="Next match"
                    >
                      ↓
                    </button>
                    <span class="match-count"
                      >{matchCount} span{matchCount !== 1 ? "s" : ""} found</span
                    >
                  </div>
                {/if}
              </div>
            </div>
            <div class="trace-duration">
              Total: <strong>{traceDuration}</strong>
            </div>
          </div>
          <div
            bind:this={waterfallContainer}
            class="waterfall-container"
            onkeydown={handleWaterfallKeydown}
            role="tree"
            tabindex="0"
            aria-label="Span tree"
          >
            <!-- Time ruler header row -->
            <div class="indicator-cell ruler-spacer"></div>
            <div class="waterfall-cell ruler-cell">
              <div
                class="time-ruler"
                style:grid-template-columns="{nameColumnWidth}px 1fr"
              >
                <div class="ruler-labels">
                  <span>Span Name</span>
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                  <div
                    class="col-resizer"
                    class:active={isColumnSplitterDragging}
                    onmousedown={handleColumnSplitterMouseDown}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize name column"
                    title="Drag to resize span name column"
                  ></div>
                </div>
                <div class="ruler-timeline">
                  <span class="ruler-mark">0ms</span>
                  <span class="ruler-mark">25%</span>
                  <span class="ruler-mark">50%</span>
                  <span class="ruler-mark">75%</span>
                  <span class="ruler-mark">{traceDuration}</span>
                </div>
              </div>
            </div>

            <!-- Waterfall rows with indicators -->
            {#each spanTree as node (node.span.spanId)}
              <div class="indicator-cell" data-span-id={node.span.spanId}>
                {#if node.span.spanId === selectedSpanId}
                  <span class="selection-indicator-outer">▶</span>
                {/if}
              </div>
              <div class="waterfall-cell">
                <WaterfallRow
                  span={node.span}
                  depth={node.depth}
                  traceStartNano={trace.startTimeUnixNano}
                  {traceDurationNs}
                  {nameColumnWidth}
                  isSelected={node.span.spanId === selectedSpanId}
                  isHighlighted={matchingSpanIds.has(node.span.spanId)}
                  hasChildren={node.children.length > 0}
                  isCollapsed={node.collapsed}
                  childCount={node.children.length}
                  subtreeSize={node.subtreeSize}
                  onSelect={() => handleSpanSelect(node.span.spanId)}
                  onToggleCollapse={() => toggleNodeCollapse(node.span.spanId)}
                  onEventClick={(eventIndex) =>
                    handleEventClick(node.span.spanId, eventIndex)}
                />
              </div>
            {/each}
          </div>
        </section>

        <!-- Splitter -->
        {#if showSpanDetails}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="splitter"
            onmousedown={handleSplitterMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
          ></div>
        {/if}

        <!-- Span Details Sidebar (Right) -->
        {#if showSpanDetails}
          <section class="sidebar-section">
            {#if selectedSpanId && trace.spans.get(selectedSpanId)}
              {@const selectedSpan = trace.spans.get(selectedSpanId)}
              {#if selectedSpan}
                <h3>Span Details</h3>
                <div class="span-details">
                  <div class="detail-row">
                    <span class="label">Name:</span>
                    <span class="value">{selectedSpan.name}</span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Started:</span>
                    <span
                      class="value"
                      title={formatTimestamp(selectedSpan.startTimeUnixNano)}
                      >{formatTimestampLocal(
                        selectedSpan.startTimeUnixNano,
                      )}</span
                    >
                  </div>
                  <div class="detail-row">
                    <span class="label">Ended:</span>
                    <span
                      class="value"
                      title={formatTimestamp(selectedSpan.endTimeUnixNano)}
                      >{formatTimestampLocal(
                        selectedSpan.endTimeUnixNano,
                      )}</span
                    >
                  </div>
                  <div class="detail-row">
                    <span class="label">Duration:</span>
                    <span class="value">
                      {formatDuration(
                        selectedSpan.startTimeUnixNano,
                        selectedSpan.endTimeUnixNano,
                      )}
                    </span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Kind:</span>
                    <span class="value">{spanKindLabel(selectedSpan.kind)}</span
                    >
                  </div>
                  <div class="detail-row">
                    <span class="label">Status:</span>
                    <span
                      class="value"
                      class:status-error={selectedSpan.status.code === 2}
                      class:status-ok={selectedSpan.status.code === 1}
                    >
                      {statusLabel(selectedSpan.status.code)}
                      {#if selectedSpan.status.message}
                        - {selectedSpan.status.message}
                      {/if}
                    </span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Span ID:</span>
                    <span class="value mono">{selectedSpan.spanId}</span>
                  </div>
                  {#if selectedSpan.parentSpanId}
                    <div class="detail-row">
                      <span class="label">Parent ID:</span>
                      <button
                        class="value mono parent-link"
                        onclick={() =>
                          handleSpanSelect(selectedSpan.parentSpanId)}
                        title="Jump to parent span"
                      >
                        {selectedSpan.parentSpanId}
                      </button>
                    </div>
                  {/if}
                  <div class="detail-row">
                    <span class="label">Service:</span>
                    <span class="value"
                      >{selectedSpan.resource["service.name"] ||
                        "unknown"}</span
                    >
                  </div>

                  {#if selectedSpan.events.length > 0}
                    <div class="section-divider"></div>
                    <h4 class="section-title">
                      Events ({selectedSpan.events.length})
                    </h4>
                    {#each selectedSpan.events as event, index}
                      <div
                        class="event-item"
                        id="event-{index}"
                        class:highlighted={selectedEventIndex === index}
                      >
                        <div class="event-header">
                          <div class="event-name">{event.name}</div>
                          <div
                            class="event-timestamp"
                            title={formatTimestamp(event.timeUnixNano)}
                          >
                            {formatRelativeTime(
                              selectedSpan.startTimeUnixNano,
                              event.timeUnixNano,
                            )}
                          </div>
                        </div>
                        {#if Object.keys(event.attributes).length > 0}
                          <div class="event-attributes">
                            {#each Object.entries(event.attributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                              <AttributeItem
                                attrKey={key}
                                {value}
                                onFullscreen={openFullscreen}
                              />
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  {/if}

                  {#if selectedSpan.links.length > 0}
                    <div class="section-divider"></div>
                    <h4 class="section-title">
                      Links ({selectedSpan.links.length})
                    </h4>
                    {#each selectedSpan.links as link}
                      <div class="link-item">
                        <div class="link-info">
                          <div class="link-field">
                            <span class="link-label">Trace ID:</span>
                            <a
                              href="/trace/{link.traceId}"
                              class="link-value mono link-anchor"
                              title="Open linked trace"
                            >
                              {link.traceId}
                            </a>
                          </div>
                          <div class="link-field">
                            <span class="link-label">Span ID:</span>
                            <a
                              href="/trace/{link.traceId}?spanId={link.spanId}"
                              class="link-value mono link-anchor"
                              title="Open linked trace and select span"
                            >
                              {link.spanId}
                            </a>
                          </div>
                          {#if link.traceState}
                            <div class="link-field">
                              <span class="link-label">State:</span>
                              <span class="link-value">{link.traceState}</span>
                            </div>
                          {/if}
                        </div>
                        {#if Object.keys(link.attributes).length > 0}
                          <div class="link-attributes">
                            {#each Object.entries(link.attributes).sort( ([a], [b]) => a.localeCompare(b), ) as [key, value]}
                              <AttributeItem
                                attrKey={key}
                                {value}
                                onFullscreen={openFullscreen}
                              />
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  {/if}

                  {#if Object.keys(selectedSpan.attributes).length > 0}
                    {@const allAttributes = Object.entries(
                      selectedSpan.attributes,
                    ).sort(([a], [b]) => a.localeCompare(b))}
                    {@const filteredAttributes = attributeFilter.trim()
                      ? allAttributes.filter(([key, value]) => {
                          const query = attributeFilter.toLowerCase();
                          const keyMatch = key.toLowerCase().includes(query);
                          const valueMatch = JSON.stringify(value)
                            .toLowerCase()
                            .includes(query);
                          return keyMatch || valueMatch;
                        })
                      : allAttributes}
                    <div class="section-divider"></div>
                    <div class="section-header">
                      <h4 class="section-title">
                        Attributes
                        {#if attributeFilter.trim()}
                          ({filteredAttributes.length} of {allAttributes.length})
                        {:else}
                          ({allAttributes.length})
                        {/if}
                      </h4>
                      <input
                        id="attribute-filter"
                        type="text"
                        bind:value={attributeFilter}
                        placeholder="Filter attributes..."
                        class="attribute-filter"
                      />
                    </div>
                    {#if filteredAttributes.length > 0}
                      <div class="attributes">
                        {#each filteredAttributes as [key, value]}
                          <AttributeItem
                            attrKey={key}
                            {value}
                            onFullscreen={openFullscreen}
                          />
                        {/each}
                      </div>
                    {:else}
                      <div class="no-attributes">
                        No attributes match the filter.
                      </div>
                    {/if}
                  {/if}

                  {#if Object.keys(selectedSpan.resource).length > 0}
                    {@const allResourceEntries = Object.entries(
                      selectedSpan.resource,
                    ).sort(([a], [b]) => a.localeCompare(b))}
                    {@const filteredResource = resourceFilter.trim()
                      ? allResourceEntries.filter(([key, value]) => {
                          const q = resourceFilter.toLowerCase();
                          return (
                            key.toLowerCase().includes(q) ||
                            JSON.stringify(value).toLowerCase().includes(q)
                          );
                        })
                      : allResourceEntries}
                    <div class="section-divider"></div>
                    <div class="section-header">
                      <button
                        class="section-toggle"
                        onclick={() => (resourceCollapsed = !resourceCollapsed)}
                        aria-expanded={!resourceCollapsed}
                        title={resourceCollapsed
                          ? "Expand resource"
                          : "Collapse resource"}
                      >
                        <ChevronIcon expanded={!resourceCollapsed} />
                        <h4 class="section-title">
                          Resource
                          {#if resourceFilter.trim()}
                            ({filteredResource.length} of {allResourceEntries.length})
                          {:else}
                            ({allResourceEntries.length})
                          {/if}
                        </h4>
                      </button>
                      {#if !resourceCollapsed}
                        <input
                          type="text"
                          bind:value={resourceFilter}
                          placeholder="Filter resource..."
                          class="attribute-filter"
                        />
                      {/if}
                    </div>
                    {#if !resourceCollapsed}
                      {#if filteredResource.length > 0}
                        <div class="attributes">
                          {#each filteredResource as [key, value]}
                            <AttributeItem
                              attrKey={key}
                              {value}
                              onFullscreen={openFullscreen}
                            />
                          {/each}
                        </div>
                      {:else}
                        <div class="no-attributes">
                          No resource attributes match the filter.
                        </div>
                      {/if}
                    {/if}
                  {/if}

                  {#if selectedSpan.scopeName || selectedSpan.scopeVersion || Object.keys(selectedSpan.scopeAttributes).length > 0}
                    {@const allScopeEntries = Object.entries(
                      selectedSpan.scopeAttributes,
                    ).sort(([a], [b]) => a.localeCompare(b))}
                    {@const filteredScope = scopeFilter.trim()
                      ? allScopeEntries.filter(([key, value]) => {
                          const q = scopeFilter.toLowerCase();
                          return (
                            key.toLowerCase().includes(q) ||
                            JSON.stringify(value).toLowerCase().includes(q)
                          );
                        })
                      : allScopeEntries}
                    <div class="section-divider"></div>
                    <div class="section-header">
                      <button
                        class="section-toggle"
                        onclick={() => (scopeCollapsed = !scopeCollapsed)}
                        aria-expanded={!scopeCollapsed}
                        title={scopeCollapsed
                          ? "Expand scope"
                          : "Collapse scope"}
                      >
                        <ChevronIcon expanded={!scopeCollapsed} />
                        <h4 class="section-title">
                          Scope
                          {#if allScopeEntries.length > 0}
                            {#if scopeFilter.trim()}
                              ({filteredScope.length} of {allScopeEntries.length}
                              attrs)
                            {:else}
                              ({allScopeEntries.length} attrs)
                            {/if}
                          {/if}
                        </h4>
                      </button>
                      {#if !scopeCollapsed && allScopeEntries.length > 0}
                        <input
                          type="text"
                          bind:value={scopeFilter}
                          placeholder="Filter scope attrs..."
                          class="attribute-filter"
                        />
                      {/if}
                    </div>
                    {#if !scopeCollapsed}
                      {#if selectedSpan.scopeName}
                        <div class="detail-row">
                          <span class="label">Name:</span>
                          <span class="value">{selectedSpan.scopeName}</span>
                        </div>
                      {/if}
                      {#if selectedSpan.scopeVersion}
                        <div class="detail-row">
                          <span class="label">Version:</span>
                          <span class="value">{selectedSpan.scopeVersion}</span>
                        </div>
                      {/if}
                      {#if allScopeEntries.length > 0}
                        {#if filteredScope.length > 0}
                          <div class="attributes">
                            {#each filteredScope as [key, value]}
                              <AttributeItem
                                attrKey={key}
                                {value}
                                onFullscreen={openFullscreen}
                              />
                            {/each}
                          </div>
                        {:else}
                          <div class="no-attributes">
                            No scope attributes match the filter.
                          </div>
                        {/if}
                      {/if}
                    {/if}
                  {/if}
                </div>
              {/if}
            {:else}
              <div class="no-selection">
                <p>Select a span to view details</p>
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Fullscreen attribute value modal -->
{#if fullscreenAttr}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fullscreen-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Full attribute value"
  >
    <button
      class="fullscreen-backdrop"
      onclick={closeFullscreen}
      aria-label="Close"
      tabindex="-1"
    ></button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fullscreen-modal"
      tabindex="-1"
      onkeydown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeFullscreen();
        }
      }}
      use:autoFocus
    >
      <div class="fullscreen-header">
        <span class="fullscreen-key">{fullscreenAttr.key}</span>
        <div class="fullscreen-actions">
          <button
            class="fullscreen-action-btn"
            class:copied={fullscreenCopied}
            onclick={copyFullscreenValue}
            title="Copy value"
          >
            {#if fullscreenCopied}
              <svg
                width="14"
                height="14"
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
              Copied
            {:else}
              <svg
                width="14"
                height="14"
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
              Copy
            {/if}
          </button>
          <button
            class="fullscreen-close-btn"
            onclick={closeFullscreen}
            title="Close (Esc)">✕</button
          >
        </div>
      </div>
      <pre class="fullscreen-value">{fullscreenAttr.value}</pre>
    </div>
  </div>
{/if}

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      { keys: ["/"], description: "Focus span search" },
      {
        keys: ["Esc"],
        description:
          "Dismiss search (when search focused) / Go back to trace list",
      },
      {
        keys: ["Enter"],
        description: "Next search match (when search focused)",
      },
      {
        keys: ["Shift+Enter"],
        description: "Previous search match (when search focused)",
      },
      { keys: ["n"], description: "Next search match" },
      { keys: ["Shift+N"], description: "Previous search match" },
      { keys: ["e"], description: "Next error span" },
      { keys: ["Shift+E"], description: "Previous error span" },
      { keys: ["↑ / ↓"], description: "Navigate spans up / down" },
      { keys: ["← / →"], description: "Collapse / expand selected span" },
      { keys: ["Enter"], description: "Toggle collapse on selected span" },
      { keys: ["m"], description: "Toggle mini service map" },
      { keys: ["?"], description: "Toggle keyboard shortcuts help" },
    ]}
    onclose={() => (showShortcuts = false)}
  />
{/if}

<style>
  :global(body.dragging-splitter) {
    cursor: col-resize !important;
    user-select: none;
  }

  .trace-detail {
    height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-page);
  }

  .header {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .view-controls {
    display: flex;
    gap: 0.5rem;
  }

  .back-button {
    padding: 0.5rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .back-button:hover {
    background: var(--bg-muted);
  }

  .toggle-button {
    padding: 0.5rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-primary);
    transition: all 0.15s ease;
  }

  .toggle-button:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
  }

  .toggle-button:active {
    background: var(--selected-bg);
  }

  .maximize-button {
    border-color: var(--accent);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .maximize-button:hover {
    background: var(--selected-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .shortcut-help-btn {
    padding: 0.5rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .shortcut-help-btn:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
    color: var(--accent);
  }

  .loading,
  .error {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .error {
    color: var(--error-text);
  }

  .trace-container {
    width: 100%;
    padding: 0.75rem 0.75rem 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .trace-identification {
    background: var(--bg-surface);
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
  }

  .trace-id-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .trace-identification h2 {
    font-size: 1.25rem;
    margin: 0;
    font-family: monospace;
  }

  .trace-id-copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    flex-shrink: 0;
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
  }

  .trace-id-copy-btn:hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .trace-id-copy-btn.copied {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .trace-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .trace-timestamps {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-light);
  }

  .timestamp-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .timestamp-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .timestamp-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-family: monospace;
  }

  /* Mini service map */
  .mini-map-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-light);
  }

  .mini-map-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: color 0.15s ease;
  }

  .mini-map-toggle:hover {
    color: var(--text-primary);
  }

  .mini-map-count {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .mini-map-wrap {
    margin-top: 0.75rem;
    overflow: hidden;
  }

  .mini-map-loading {
    padding: 1rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .separator {
    color: var(--border-sep);
  }

  .service {
    font-weight: 600;
    color: var(--accent);
  }

  .root-span {
    font-family: monospace;
  }

  .error-badge {
    background: var(--error-bg);
    color: var(--error-text);
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 8px 400px;
    gap: 0;
    position: relative;
    flex: 1;
    min-height: 0;
    align-items: stretch;
    padding-bottom: 0.75rem;
  }

  .content-grid.full-width {
    grid-template-columns: 1fr;
  }

  .waterfall-section {
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
    margin-right: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar-section {
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px var(--shadow);
    margin-left: 0;
    min-height: 0;
    overflow-y: auto;
  }

  .splitter {
    width: 8px;
    background: transparent;
    cursor: col-resize;
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s ease;
  }

  .splitter::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 40px;
    background: var(--splitter-bar);
    border-radius: 1px;
    transition: background 0.2s ease;
  }

  .splitter:hover::before {
    background: var(--accent);
  }

  .splitter:hover {
    background: var(--splitter-hover-bg);
  }

  .waterfall-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .waterfall-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
  }

  .error-navigation {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .error-badge-nav {
    background: var(--error-bg);
    color: var(--error-text);
    padding: 0.375rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .position-indicator {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-family: monospace;
    white-space: nowrap;
  }

  .search-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    max-width: 500px;
  }

  .span-search-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    flex: 1;
    min-width: 150px;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .span-search-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-ring);
  }

  .search-navigation {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .nav-button {
    padding: 0.375rem 0.5rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-primary);
    transition: all 0.15s ease;
    min-width: 28px;
  }

  .nav-button:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
  }

  .nav-button:active {
    background: var(--bg-muted);
  }

  .match-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .trace-duration {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .trace-duration strong {
    color: var(--accent);
    font-family: monospace;
  }

  .sidebar-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .waterfall-container {
    display: grid;
    grid-template-columns: 20px 1fr;
    align-content: start;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .waterfall-container:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .indicator-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid var(--border);
  }

  .indicator-cell.ruler-spacer {
    background: var(--bg-page);
    position: sticky;
    top: 0;
    z-index: 11;
  }

  .waterfall-cell.ruler-cell {
    position: sticky;
    top: 0;
    z-index: 11;
  }

  .selection-indicator-outer {
    color: var(--accent);
    font-size: 0.875rem;
    line-height: 1;
  }

  .time-ruler {
    display: grid;
    grid-template-columns: 420px 1fr;
    gap: 1rem;
    padding: 0.75rem 0.5rem;
    background: var(--bg-page);
    border-bottom: 2px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .ruler-labels {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    position: relative;
  }

  .col-resizer {
    position: absolute;
    right: -12px;
    top: 0;
    bottom: 0;
    width: 16px;
    cursor: col-resize;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .col-resizer::after {
    content: "";
    display: block;
    width: 3px;
    height: 60%;
    border-radius: 2px;
    background: var(--border);
    transition: background 0.15s ease;
  }

  .col-resizer:hover::after,
  .col-resizer.active::after {
    background: var(--accent);
  }

  .ruler-timeline {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0.5rem;
    font-family: monospace;
  }

  .ruler-mark {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .no-selection {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-muted);
  }

  .span-details {
    font-size: 0.875rem;
    overflow-y: auto;
  }

  .detail-row {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border-light);
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.4rem;
  }

  .detail-row .label {
    font-weight: 600;
    color: var(--text-secondary);
  }

  .detail-row .value {
    color: var(--text-primary);
    word-break: break-all;
  }

  .status-error {
    color: var(--error-text);
    font-weight: 600;
  }

  .status-ok {
    color: var(--ok-text);
    font-weight: 600;
  }

  .parent-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: all 0.15s ease;
  }

  .parent-link:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  .mono {
    font-family: monospace;
  }

  .section-divider {
    border-top: 2px solid var(--border);
    margin: 1.5rem 0 1rem 0;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .section-header .section-title {
    margin: 0;
    flex: 1;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .section-toggle:hover .section-title {
    color: var(--accent, var(--text-primary));
  }

  .section-toggle .section-title {
    margin: 0;
    flex: 1;
  }

  .attribute-filter {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    width: 200px;
    transition: all 0.15s ease;
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .attribute-filter:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-ring);
  }

  .attribute-filter::placeholder {
    color: var(--text-muted);
  }

  .event-item {
    padding: 0.75rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid var(--accent);
    transition: all 0.3s ease;
    scroll-margin-top: 20px;
  }

  .event-item.highlighted {
    background: var(--highlight-bg);
    border-left-color: var(--event-color);
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    gap: 1rem;
  }

  .event-name {
    font-weight: 600;
    color: var(--accent);
    font-size: 0.875rem;
    flex: 1;
  }

  .event-timestamp {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
    cursor: help;
  }

  .event-attributes {
    margin-left: 0.5rem;
  }

  .link-item {
    padding: 0.75rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 3px solid var(--link-accent);
  }

  .link-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .link-field {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .link-label {
    font-weight: 600;
    color: var(--text-secondary);
    min-width: 70px;
  }

  .link-value {
    color: var(--text-primary);
    word-break: break-all;
  }

  .link-anchor {
    color: var(--accent);
    text-decoration: none;
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .link-anchor:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  .link-anchor:visited {
    color: var(--link-visited);
  }

  .link-attributes {
    margin-top: 0.5rem;
    margin-left: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .attributes {
    background: var(--bg-surface-hover);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
  }

  .no-attributes {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
    background: var(--bg-surface-hover);
    border-radius: 4px;
  }

  /* Fullscreen modal */
  .fullscreen-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fullscreen-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    border: none;
    padding: 0;
    cursor: default;
  }

  .fullscreen-modal {
    position: relative;
    z-index: 1;
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow:
      0 8px 32px var(--shadow),
      0 2px 8px var(--shadow-sm);
    width: 75vw;
    height: 75vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }

  .fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-code);
    gap: 1rem;
    flex-shrink: 0;
  }

  .fullscreen-key {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent);
    font-family: monospace;
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }

  .fullscreen-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .fullscreen-action-btn {
    padding: 0.375rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--text-primary);
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
  }

  .fullscreen-action-btn:hover {
    background: var(--attr-number-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .fullscreen-action-btn.copied {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--ok-text);
  }

  .fullscreen-close-btn {
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

  .fullscreen-close-btn:hover {
    background: var(--error-bg);
    border-color: var(--error-text);
    color: var(--error-text);
  }

  .fullscreen-value {
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--text-primary);
    padding: 1rem;
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    flex: 1;
  }
</style>
