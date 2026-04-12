<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import { page } from '$app/stores'
  import FullscreenValueModal from '$lib/components/FullscreenValueModal.svelte'
  import KeyboardShortcutsHelp from '$lib/components/KeyboardShortcutsHelp.svelte'
  import SpanDetailsSidebar from '$lib/components/SpanDetailsSidebar.svelte'
  import TraceHeader from '$lib/components/TraceHeader.svelte'
  import WaterfallRow from '$lib/components/WaterfallRow.svelte'
  import { traceStore } from '$lib/stores/traces.svelte'
  import { isInputFocused } from '$lib/utils/keyboard'
  import { buildSpanTree, flattenSpanTree } from '$lib/utils/spans'
  import { findMatchingSpanIds } from '$lib/utils/spanSearch'
  import { formatDuration } from '$lib/utils/time'
  import { onMount } from 'svelte'

  import type {
    ServiceMapData,
    SpanTreeNode,
    StoredTrace,
    TraceLogDetail,
    TraceLogListItem,
  } from '$lib/types'

  // Keep SSE active on detail page so we can detect when this trace changes.
  traceStore.connectSSE()

  // Get trace ID from URL
  const traceId = $derived($page.params.traceId)
  const spanIdFromUrl = $derived($page.url.searchParams.get('spanId'))
  const logIdFromUrl = $derived($page.url.searchParams.get('logId'))

  // Page title with shortened trace ID
  const pageTitle = $derived(
    traceId ? `otel-gui – Trace ${traceId.slice(0, 8)}` : 'otel-gui – Trace',
  )

  // Local state
  let trace = $state<StoredTrace | null>(null)
  let spanTreeRoot = $state<SpanTreeNode[]>([]) // Tree structure with collapse state
  let spanTree = $state<SpanTreeNode[]>([]) // Flattened view for rendering
  let selectedSpanId = $state<string | null>(null)
  let selectedLogId = $state<string | null>(null)
  let logDetailsById = $state<Record<string, TraceLogDetail>>({})
  let loadingLogDetailById = $state<Record<string, boolean>>({})
  let logDetailErrorsById = $state<Record<string, string>>({})
  let traceLogs = $state<TraceLogListItem[]>([])
  let selectedEventIndex = $state<number | null>(null)
  let spanSearchQuery = $state<string>('')
  let currentMatchIndex = $state<number>(0)
  let currentErrorIndex = $state<number>(-1)
  let isLoading = $state<boolean>(true)
  let error = $state<string | null>(null)
  let showTraceDetails = $state<boolean>(true)
  let showSpanDetails = $state<boolean>(true)
  let isMaximized = $derived(!showTraceDetails && !showSpanDetails)
  let waterfallContainer = $state<HTMLDivElement | null>(null)
  let sidebarWidth = $state<number>(425)
  let isDraggingSplitter = $state<boolean>(false)
  let contentGridElement = $state<HTMLDivElement | null>(null)
  let nameColumnWidth = $state<number>(420)
  let isColumnSplitterDragging = $state<boolean>(false)
  let fullscreenAttr = $state<{ key: string; value: string } | null>(null)
  // Mini service map
  let showMiniMap = $state(false)
  let miniMapData = $state<ServiceMapData | null>(null)
  let miniMapLoading = $state(false)
  let spanSearchInputEl = $state<HTMLInputElement | null>(null)
  let showShortcuts = $state(false)
  let isExporting = $state(false)
  let exportError = $state<string | null>(null)
  let autoRefreshEnabled = $state(false)
  let showRefreshMenu = $state(false)
  let refreshSplitContainer = $state<HTMLElement | null>(null)
  let lastAutoRefreshSourceUpdatedAt = $state<number | null>(null)

  const liveTraceSummary = $derived(
    traceStore.traces.find((item) => item.traceId === traceId) || null,
  )
  const needsRefresh = $derived(
    !!trace &&
      !!liveTraceSummary &&
      liveTraceSummary.updatedAt > trace.updatedAt,
  )

  function openFullscreen(key: string, formatted: string) {
    fullscreenAttr = { key, value: formatted }
  }

  function closeFullscreen() {
    fullscreenAttr = null
  }

  // Derived: trace duration for waterfall calculation
  const traceDurationNs = $derived(
    trace
      ? BigInt(trace.endTimeUnixNano) - BigInt(trace.startTimeUnixNano)
      : 0n,
  )
  const formattedTraceDuration = $derived(
    trace
      ? formatDuration(trace.startTimeUnixNano, trace.endTimeUnixNano)
      : null,
  )

  // Derived: unique service count and max tree depth
  const serviceCount = $derived(
    trace
      ? new Set(
          Array.from(trace.spans.values()).map(
            (s) => (s.resource['service.name'] as string) || 'unknown',
          ),
        ).size
      : 0,
  )

  const maxDepth = $derived(
    spanTree.length > 0 ? Math.max(...spanTree.map((n) => n.depth)) + 1 : 0,
  )

  const matchingSpanIds = $derived(
    findMatchingSpanIds(spanTree, spanSearchQuery, traceLogs),
  )

  const matchingSpans = $derived(
    spanTree.filter((node) => matchingSpanIds.has(node.span.spanId)),
  )

  const traceLogsBySpanId = $derived(
    (() => {
      const bySpanId = new Map<string, TraceLogListItem[]>()
      for (const log of traceLogs) {
        if (!log.spanId) continue
        const forSpan = bySpanId.get(log.spanId)
        if (forSpan) {
          forSpan.push(log)
        } else {
          bySpanId.set(log.spanId, [log])
        }
      }
      return bySpanId
    })(),
  )

  const matchCount = $derived(matchingSpanIds.size)

  // Error span tracking
  // errorSpans: visible error spans only (used for navigation)
  const errorSpans = $derived(
    spanTree.filter((node) => node.span.status.code === 2),
  )

  const errorCount = $derived(errorSpans.length)

  // Helper function to count all error spans recursively (including collapsed)
  function countAllErrorSpans(nodes: SpanTreeNode[]): number {
    let count = 0
    for (const node of nodes) {
      if (node.span.status.code === 2) {
        count++
      }
      if (node.children.length > 0) {
        count += countAllErrorSpans(node.children)
      }
    }
    return count
  }

  // totalErrorCount: all error spans in the trace (regardless of collapse state)
  const totalErrorCount = $derived(countAllErrorSpans(spanTreeRoot))

  // Reset current match index when search changes
  $effect(() => {
    if (spanSearchQuery) {
      currentMatchIndex = 0
    }
  })

  // Auto-refresh immediately when newer data is detected and the mode is enabled.
  $effect(() => {
    if (
      !autoRefreshEnabled ||
      !needsRefresh ||
      isLoading ||
      !liveTraceSummary
    ) {
      return
    }

    if (lastAutoRefreshSourceUpdatedAt === liveTraceSummary.updatedAt) {
      return
    }

    lastAutoRefreshSourceUpdatedAt = liveTraceSummary.updatedAt
    void handleRefresh()
  })

  // Reset current error index when trace changes
  $effect(() => {
    if (errorCount > 0) {
      currentErrorIndex = -1
    }
  })

  // Update currentErrorIndex when selectedSpanId changes
  $effect(() => {
    if (!selectedSpanId) {
      currentErrorIndex = -1
      return
    }

    // Find the index of the selected span in errorSpans
    const errorIndex = errorSpans.findIndex(
      (node) => node.span.spanId === selectedSpanId,
    )

    // If selected span is an error span, update currentErrorIndex
    // Otherwise, set it to -1
    currentErrorIndex = errorIndex
  })

  // Load trace data on mount
  onMount(async () => {
    await loadTrace()
  })

  // Reload trace when URL changes (for hyperlink navigation)
  $effect(() => {
    // Watch for changes in traceId or spanIdFromUrl
    if (traceId) {
      loadTrace()
    }
  })

  // Add mouse event listeners for splitter dragging
  $effect(() => {
    if (typeof window === 'undefined') return

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  })

  // Handle Escape in capture phase so it fires before browser-native input
  // handling (Chrome resets/blurs inputs on Esc before bubbling; Firefox
  // consumes Esc at the accessibility layer for certain roles) and before
  // any element-level keydown handlers.
  $effect(() => {
    if (typeof document === 'undefined') return

    function handleRefreshMenuPointerDown(event: MouseEvent) {
      if (!showRefreshMenu) return
      const target = event.target as Node | null
      if (
        refreshSplitContainer &&
        target &&
        !refreshSplitContainer.contains(target)
      ) {
        showRefreshMenu = false
      }
    }

    function handleEscCapture(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (fullscreenAttr) return // fullscreen modal handles its own Esc

      if (showRefreshMenu) {
        e.preventDefault()
        showRefreshMenu = false
        return
      }

      if (showShortcuts) {
        e.preventDefault()
        showShortcuts = false
        return
      }

      // If the span search is focused: clear it and move focus to waterfall.
      // Any other focused element (including filter inputs, buttons, waterfall): go back.
      if (spanSearchInputEl && document.activeElement === spanSearchInputEl) {
        e.preventDefault()
        spanSearchQuery = ''
        spanSearchInputEl.blur()
        waterfallContainer?.focus()
      } else {
        e.preventDefault()
        handleBack()
      }
    }

    document.addEventListener('mousedown', handleRefreshMenuPointerDown)
    document.addEventListener('keydown', handleEscCapture, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleRefreshMenuPointerDown)
      document.removeEventListener('keydown', handleEscCapture, {
        capture: true,
      })
    }
  })

  // Auto-restore span details panel when a span is selected.
  // NOTE: must NOT read showSpanDetails here — doing so would make it a
  // reactive dependency, causing the effect to re-run (and immediately
  // undo) whenever the user clicks "Hide Span Details".
  $effect(() => {
    if (selectedSpanId) {
      showSpanDetails = true
    }
  })

  // Auto-focus waterfall container when trace loads
  $effect(() => {
    if (waterfallContainer && trace && selectedSpanId && !isLoading) {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        waterfallContainer?.focus()
      }, 0)
    }
  })

  // Auto-scroll selected span row into view
  $effect(() => {
    if (!selectedSpanId || !waterfallContainer) return
    // Run after the DOM has re-rendered with the new selection
    requestAnimationFrame(() => {
      const row = waterfallContainer?.querySelector(
        `[data-span-id="${selectedSpanId}"]`,
      )
      row?.scrollIntoView({ block: 'nearest' })
    })
  })

  async function loadTrace() {
    if (!traceId) {
      error = 'No trace ID provided'
      isLoading = false
      return
    }
    isLoading = true
    error = null
    try {
      const data = await traceStore.fetchTrace(traceId)
      if (data) {
        // API returns spans as Record, convert to Map for type compatibility
        const spansMap = new Map<string, any>()
        const spansArray = []
        for (const [id, span] of Object.entries(data.spans)) {
          spansMap.set(id, span)
          spansArray.push(span)
        }
        trace = {
          ...data,
          updatedAt: data.updatedAt ?? Date.now(),
          spans: spansMap,
        }
        // Build tree and flatten for rendering
        spanTreeRoot = buildSpanTree(spansArray)
        spanTree = flattenSpanTree(spanTreeRoot)

        // Auto-select span from URL query parameter if present, otherwise select root span
        if (spanIdFromUrl && spansMap.has(spanIdFromUrl)) {
          selectedSpanId = spanIdFromUrl
        } else if (spanTreeRoot.length > 0) {
          // Preselect the root span (first node in tree)
          selectedSpanId = spanTreeRoot[0].span.spanId
        } else {
          selectedSpanId = null
        }

        traceLogs = await traceStore.fetchTraceLogs(traceId, { limit: 1000 })
        if (logIdFromUrl && traceLogs.some((log) => log.id === logIdFromUrl)) {
          selectedLogId = logIdFromUrl
        } else {
          selectedLogId = null
        }
        logDetailsById = {}
        loadingLogDetailById = {}
        logDetailErrorsById = {}

        if (!spanIdFromUrl && selectedLogId) {
          const selectedLog = traceLogs.find((log) => log.id === selectedLogId)
          if (
            selectedLog?.spanId &&
            spansMap.has(selectedLog.spanId) &&
            selectedSpanId !== selectedLog.spanId
          ) {
            selectedSpanId = selectedLog.spanId
          }
        }
      } else {
        error = 'Trace not found'
      }
      // Load mini service map for this trace
      miniMapLoading = true
      try {
        const mapRes = await fetch(`/api/service-map?traceId=${traceId}`)
        if (mapRes.ok) {
          miniMapData = await mapRes.json()
        }
      } catch {
        // silently ignore map errors
      } finally {
        miniMapLoading = false
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error loading trace'
    } finally {
      isLoading = false
    }
  }

  // Splitter drag handlers - sidebar (right panel)
  function handleSplitterMouseDown(e: MouseEvent) {
    isDraggingSplitter = true
    document.body.classList.add('dragging-splitter')
    e.preventDefault()
  }

  // Column splitter drag handler - name column vs timeline
  function handleColumnSplitterMouseDown(e: MouseEvent) {
    isColumnSplitterDragging = true
    document.body.classList.add('dragging-splitter')
    e.preventDefault()
  }

  function handleMouseMove(e: MouseEvent) {
    if (isDraggingSplitter && contentGridElement) {
      const gridRect = contentGridElement.getBoundingClientRect()
      const newWidth = gridRect.right - e.clientX
      // Constrain: sidebar min 200px, timeline (left side) min 200px
      const maxSidebar = gridRect.width - 8 - 200
      sidebarWidth = Math.max(200, Math.min(maxSidebar, newWidth))
    }

    if (isColumnSplitterDragging && waterfallContainer) {
      const rect = waterfallContainer.getBoundingClientRect()
      // 20px indicator column + 8px left padding of the row
      const newWidth = e.clientX - rect.left - 20 - 8
      // Min 120px, max: leave at least 200px for the timeline
      const maxNameCol = rect.width - 20 - 16 - 200
      nameColumnWidth = Math.max(120, Math.min(maxNameCol, newWidth))
    }
  }

  function handleMouseUp() {
    isDraggingSplitter = false
    isColumnSplitterDragging = false
    document.body.classList.remove('dragging-splitter')
  }

  // Focus restoration for header buttons
  let previousFocus: Element | null = null

  function captureWaterfallFocus() {
    previousFocus = document.activeElement
  }

  function restoreWaterfallFocus() {
    const target = previousFocus
    if (target && target !== document.body) {
      requestAnimationFrame(() => (target as HTMLElement).focus?.())
    }
  }

  function handleSpanSelect(spanId: string) {
    selectedSpanId = spanId
    showSpanDetails = true
    selectedEventIndex = null // Clear event selection when selecting a different span
    updateSelectionUrl(spanId, selectedLogId)
  }

  function updateSelectionUrl(spanId: string | null, logId: string | null) {
    const url = new URL(window.location.href)
    if (spanId) {
      url.searchParams.set('spanId', spanId)
    } else {
      url.searchParams.delete('spanId')
    }

    if (logId) {
      url.searchParams.set('logId', logId)
    } else {
      url.searchParams.delete('logId')
    }

    replaceState(url, {})
  }

  function handleLogSelect(logId: string, relatedSpanId?: string) {
    selectedLogId = logId

    if (relatedSpanId && trace?.spans.has(relatedSpanId)) {
      selectedSpanId = relatedSpanId
    }

    updateSelectionUrl(selectedSpanId, selectedLogId)
  }

  async function handleOpenLogDetail(logId: string) {
    handleLogSelect(logId)
    if (!traceId) return
    if (loadingLogDetailById[logId] || logDetailsById[logId]) return

    loadingLogDetailById = {
      ...loadingLogDetailById,
      [logId]: true,
    }
    const { [logId]: _removedError, ...remainingErrors } = logDetailErrorsById
    logDetailErrorsById = remainingErrors

    try {
      const detail = await traceStore.fetchTraceLog(traceId, logId)
      if (!detail) {
        const { [logId]: _removedDetail, ...remainingDetails } = logDetailsById
        logDetailsById = remainingDetails
        logDetailErrorsById = {
          ...logDetailErrorsById,
          [logId]: 'Could not load log detail.',
        }
        return
      }
      logDetailsById = {
        ...logDetailsById,
        [logId]: detail,
      }
    } finally {
      const { [logId]: _removedLoading, ...remainingLoading } =
        loadingLogDetailById
      loadingLogDetailById = remainingLoading
    }
  }

  function handleEventClick(spanId: string, eventIndex: number) {
    // Select the span if not already selected
    if (selectedSpanId !== spanId) {
      selectedSpanId = spanId
    }
    selectedEventIndex = eventIndex

    // Scroll to the event in the sidebar
    setTimeout(() => {
      const eventElement = document.getElementById(`event-${eventIndex}`)
      if (eventElement) {
        eventElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }

  function scrollToLogInSidebar(logId: string) {
    setTimeout(() => {
      const logElement = Array.from(
        document.querySelectorAll('[data-log-id]'),
      ).find((el) => el.getAttribute('data-log-id') === logId)
      if (logElement) {
        logElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }

  function handleWaterfallLogClick(spanId: string, logId: string) {
    if (selectedSpanId !== spanId) {
      selectedSpanId = spanId
      selectedEventIndex = null
    }
    handleLogSelect(logId, spanId)
    scrollToLogInSidebar(logId)
  }

  function handleBack() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        if (document.referrer) {
          const referrer = new URL(document.referrer)
          if (
            referrer.origin === window.location.origin &&
            referrer.pathname === '/'
          ) {
            window.history.back()
            return
          }
        }
      } catch {
        // Fall through to the plain list route when the referrer is invalid.
      }
    }

    void goto('/')
  }

  async function handleRefresh() {
    showRefreshMenu = false
    await loadTrace()
  }

  function toggleRefreshMenu(event: MouseEvent) {
    event.stopPropagation()
    showRefreshMenu = !showRefreshMenu
  }

  function handleToggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled
    showRefreshMenu = false
  }

  async function handleExportTrace() {
    if (!traceId) {
      return
    }

    isExporting = true
    exportError = null

    try {
      const response = await fetch(`/api/traces/${traceId}/export`)
      if (!response.ok) {
        throw new Error(`Failed to export trace: ${response.statusText}`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `trace-${traceId}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      exportError =
        err instanceof Error ? err.message : 'Could not export trace'
    } finally {
      isExporting = false
    }
  }

  function handleNextMatch() {
    if (matchCount === 0) return
    currentMatchIndex = (currentMatchIndex + 1) % matchCount
    const matchedSpan = matchingSpans[currentMatchIndex]
    if (matchedSpan) {
      handleSpanSelect(matchedSpan.span.spanId)
    }
  }

  function handlePreviousMatch() {
    if (matchCount === 0) return
    currentMatchIndex = (currentMatchIndex - 1 + matchCount) % matchCount
    const matchedSpan = matchingSpans[currentMatchIndex]
    if (matchedSpan) {
      handleSpanSelect(matchedSpan.span.spanId)
    }
  }

  function handleNextError() {
    if (errorCount === 0) return
    if (currentErrorIndex === -1) {
      currentErrorIndex = 0
    } else {
      currentErrorIndex = (currentErrorIndex + 1) % errorCount
    }
    const errorSpan = errorSpans[currentErrorIndex]
    if (errorSpan) {
      handleSpanSelect(errorSpan.span.spanId)
    }
  }

  function handlePreviousError() {
    if (errorCount === 0) return
    if (currentErrorIndex === -1) {
      currentErrorIndex = errorCount - 1
    } else {
      currentErrorIndex = (currentErrorIndex - 1 + errorCount) % errorCount
    }
    const errorSpan = errorSpans[currentErrorIndex]
    if (errorSpan) {
      handleSpanSelect(errorSpan.span.spanId)
    }
  }

  // Toggle collapse/expand for a span node
  function toggleNodeCollapse(spanId: string) {
    const node = findNode(spanId)
    if (!node) return

    const wasCollapsed = node.collapsed
    node.collapsed = !node.collapsed

    // If collapsing and selected span is a descendant, select this node
    if (
      !wasCollapsed &&
      selectedSpanId &&
      isDescendantOf(selectedSpanId, node)
    ) {
      selectedSpanId = spanId
    }

    spanTree = flattenSpanTree(spanTreeRoot)

    // Refocus container after toggle to maintain keyboard navigation
    if (waterfallContainer) {
      waterfallContainer.focus()
    }
  }

  // Set collapse state for a span node
  function setNodeCollapse(spanId: string, collapsed: boolean) {
    const node = findNode(spanId)
    if (!node) return

    const wasCollapsed = node.collapsed
    node.collapsed = collapsed

    // If collapsing and selected span is a descendant, select this node
    if (
      collapsed &&
      !wasCollapsed &&
      selectedSpanId &&
      isDescendantOf(selectedSpanId, node)
    ) {
      selectedSpanId = spanId
    }

    spanTree = flattenSpanTree(spanTreeRoot)

    // Refocus container after collapse state change to maintain keyboard navigation
    if (waterfallContainer) {
      waterfallContainer.focus()
    }
  }

  // Find node in tree by spanId
  function findNode(
    spanId: string,
    nodes: SpanTreeNode[] = spanTreeRoot,
  ): SpanTreeNode | null {
    for (const node of nodes) {
      if (node.span.spanId === spanId) {
        return node
      }
      const found = findNode(spanId, node.children)
      if (found) {
        return found
      }
    }
    return null
  }

  // Check if a span is a descendant of another span
  function isDescendantOf(
    descendantId: string,
    ancestorNode: SpanTreeNode,
  ): boolean {
    for (const child of ancestorNode.children) {
      if (child.span.spanId === descendantId) {
        return true
      }
      if (isDescendantOf(descendantId, child)) {
        return true
      }
    }
    return false
  }

  // Keyboard navigation handler
  function handleWaterfallKeydown(e: KeyboardEvent) {
    // Esc is handled by the capture-phase listener above; skip it here to
    // avoid double-firing.
    if (e.key === 'Escape') return

    if (!selectedSpanId || spanTree.length === 0) return

    const currentIndex = spanTree.findIndex(
      (node) => node.span.spanId === selectedSpanId,
    )
    if (currentIndex === -1) return

    const currentNode = findNode(selectedSpanId)
    if (!currentNode) return

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        if (currentIndex > 0) {
          handleSpanSelect(spanTree[currentIndex - 1].span.spanId)
        }
        break

      case 'ArrowDown':
        e.preventDefault()
        if (currentIndex < spanTree.length - 1) {
          handleSpanSelect(spanTree[currentIndex + 1].span.spanId)
        }
        break

      case 'ArrowLeft':
        e.preventDefault()
        if (currentNode.children.length > 0 && !currentNode.collapsed) {
          setNodeCollapse(selectedSpanId, true)
        }
        break

      case 'ArrowRight':
        e.preventDefault()
        if (currentNode.children.length > 0 && currentNode.collapsed) {
          setNodeCollapse(selectedSpanId, false)
        }
        break

      case 'Enter':
        e.preventDefault()
        if (currentNode.children.length > 0) {
          toggleNodeCollapse(selectedSpanId)
        }
        break
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Belt-and-suspenders: fullscreen modal handles Escape itself via stopPropagation
    if (fullscreenAttr) return

    // '/' focuses span search (only when not in an input)
    if (e.key === '/' && !isInputFocused()) {
      e.preventDefault()
      spanSearchInputEl?.focus()
      return
    }

    // Escape is handled by the capture-phase $effect listener; skip here.

    // n: next search match
    if (e.key === 'n' && !e.shiftKey && !isInputFocused() && matchCount > 0) {
      e.preventDefault()
      handleNextMatch()
      return
    }

    // Shift+N: previous search match
    if (e.key === 'N' && e.shiftKey && !isInputFocused() && matchCount > 0) {
      e.preventDefault()
      handlePreviousMatch()
      return
    }

    // e: next error span
    if (e.key === 'e' && !e.shiftKey && !isInputFocused() && errorCount > 0) {
      e.preventDefault()
      handleNextError()
      return
    }

    // Shift+E: previous error span
    if (e.key === 'E' && e.shiftKey && !isInputFocused() && errorCount > 0) {
      e.preventDefault()
      handlePreviousError()
      return
    }

    // 'm': toggle mini service map
    if (e.key === 'm' && !isInputFocused()) {
      e.preventDefault()
      showMiniMap = !showMiniMap
      return
    }
    // '?': toggle shortcuts help
    if (e.key === '?' && !isInputFocused()) {
      e.preventDefault()
      showShortcuts = !showShortcuts
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
          onclick={handleExportTrace}
          disabled={isExporting}
          title="Export this trace as JSON"
        >
          {isExporting ? 'Exporting...' : 'Export Trace'}
        </button>
        <div
          class="refresh-split-action"
          role="group"
          aria-label="Trace refresh actions"
          bind:this={refreshSplitContainer}
        >
          <button
            class="toggle-button refresh-button refresh-split-primary"
            class:refresh-needed={needsRefresh && !autoRefreshEnabled}
            class:refresh-alert={needsRefresh &&
              !isLoading &&
              !autoRefreshEnabled}
            class:auto-refresh-active={autoRefreshEnabled}
            onclick={handleRefresh}
            title={autoRefreshEnabled
              ? 'Auto-refresh is enabled. Refresh now.'
              : needsRefresh
                ? 'This trace has new data. Refresh to update the timeline.'
                : 'Refresh trace to load late-arriving spans'}
            disabled={isLoading}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              class:is-spinning={isLoading}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            class="toggle-button refresh-button refresh-split-toggle"
            class:auto-refresh-active={autoRefreshEnabled}
            onclick={toggleRefreshMenu}
            disabled={isLoading}
            aria-label="Refresh options"
            aria-expanded={showRefreshMenu}
            title="Refresh options"
          >
            ▼
          </button>

          {#if showRefreshMenu}
            <div
              class="refresh-split-menu"
              role="menu"
              aria-label="Refresh actions menu"
            >
              <button
                class="refresh-split-menu-item"
                role="menuitem"
                onclick={handleToggleAutoRefresh}
              >
                {autoRefreshEnabled
                  ? 'Disable Auto-Refresh'
                  : 'Enable Auto-Refresh'}
              </button>
            </div>
          {/if}
        </div>
        <button
          class="toggle-button"
          onpointerdown={captureWaterfallFocus}
          onclick={() => {
            showTraceDetails = !showTraceDetails
            restoreWaterfallFocus()
          }}
          title={showTraceDetails ? 'Hide trace details' : 'Show trace details'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            {#if !showTraceDetails}
              <path
                d="M1.3 7s2.1-3.3 5.7-3.3S12.7 7 12.7 7s-2.1 3.3-5.7 3.3S1.3 7 1.3 7Z"
                stroke="currentColor"
                stroke-width="1.3"
              />
              <circle
                cx="7"
                cy="7"
                r="1.8"
                stroke="currentColor"
                stroke-width="1.3"
              />
            {:else}
              <path
                d="M1.3 7s2.1-3.3 5.7-3.3S12.7 7 12.7 7s-2.1 3.3-5.7 3.3S1.3 7 1.3 7Z"
                stroke="currentColor"
                stroke-width="1.3"
              />
              <path
                d="M2 12 12 2"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            {/if}
          </svg>
          {showTraceDetails ? 'Hide' : 'Show'} Trace Details
        </button>
        <button
          class="toggle-button"
          onpointerdown={captureWaterfallFocus}
          onclick={() => {
            showSpanDetails = !showSpanDetails
            restoreWaterfallFocus()
          }}
          title={showSpanDetails ? 'Hide span details' : 'Show span details'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            {#if !showSpanDetails}
              <path
                d="M2.2 2.2h9.6v9.6H2.2z"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
              <path
                d="M5 2.2v9.6"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            {:else}
              <path
                d="M2.2 2.2h9.6v9.6H2.2z"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
              <path
                d="M2 12 12 2"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            {/if}
          </svg>
          {showSpanDetails ? 'Hide' : 'Show'} Span Details
        </button>
        {#if !isMaximized}
          <button
            class="toggle-button maximize-button"
            onpointerdown={captureWaterfallFocus}
            onclick={() => {
              showTraceDetails = false
              showSpanDetails = false
              restoreWaterfallFocus()
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
    {#if exportError}
      <div class="error export-error">{exportError}</div>
    {/if}
    <div class="trace-container">
      <!-- Trace Identification Section -->
      {#if showTraceDetails}
        <TraceHeader
          {trace}
          {serviceCount}
          {maxDepth}
          traceDuration={formattedTraceDuration!}
          {miniMapData}
          {miniMapLoading}
          bind:showMiniMap
        />
      {/if}

      <!-- Main Content Grid -->
      <div
        class="content-grid"
        class:full-width={!showSpanDetails}
        bind:this={contentGridElement}
        style:grid-template-columns={showSpanDetails
          ? `1fr 8px ${sidebarWidth}px`
          : '1fr'}
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
                    if (e.key === 'Enter' && matchCount > 0) {
                      e.preventDefault()
                      e.shiftKey ? handlePreviousMatch() : handleNextMatch()
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
                      >{matchCount} span{matchCount !== 1 ? 's' : ''} found</span
                    >
                  </div>
                {/if}
              </div>
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
                  <span class="ruler-mark"
                    >{formattedTraceDuration?.simple}</span
                  >
                </div>
              </div>
            </div>

            <!-- Waterfall rows -->
            {#each spanTree as node (node.span.spanId)}
              <div class="waterfall-cell" data-span-id={node.span.spanId}>
                <WaterfallRow
                  span={node.span}
                  spanLogs={traceLogsBySpanId.get(node.span.spanId) || []}
                  {selectedLogId}
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
                  isPhantom={node.isPhantom ?? false}
                  onSelect={() => handleSpanSelect(node.span.spanId)}
                  onToggleCollapse={() => toggleNodeCollapse(node.span.spanId)}
                  onEventClick={(eventIndex) =>
                    handleEventClick(node.span.spanId, eventIndex)}
                  onLogClick={(logId) =>
                    handleWaterfallLogClick(node.span.spanId, logId)}
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
              {@const selectedSpan = trace.spans.get(selectedSpanId)!}
              <h3>Span Details</h3>
              <SpanDetailsSidebar
                span={selectedSpan}
                {traceLogs}
                {selectedLogId}
                {logDetailsById}
                {loadingLogDetailById}
                {logDetailErrorsById}
                onSelectSpan={handleSpanSelect}
                onSelectLog={handleLogSelect}
                onOpenLogDetail={handleOpenLogDetail}
                onFullscreen={openFullscreen}
                highlightedEventIndex={selectedEventIndex}
                searchQuery={spanSearchQuery}
                allSpanIds={trace.spans}
              />
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
<FullscreenValueModal attr={fullscreenAttr} onclose={closeFullscreen} />

{#if showShortcuts}
  <KeyboardShortcutsHelp
    shortcuts={[
      { keys: ['/'], description: 'Focus span search' },
      {
        keys: ['Esc'],
        description:
          'Dismiss search (when search focused) / Go back to trace list',
      },
      {
        keys: ['Enter'],
        description: 'Next search match (when search focused)',
      },
      {
        keys: ['Shift+Enter'],
        description: 'Previous search match (when search focused)',
      },
      { keys: ['n'], description: 'Next search match' },
      { keys: ['Shift+N'], description: 'Previous search match' },
      { keys: ['e'], description: 'Next error span' },
      { keys: ['Shift+E'], description: 'Previous error span' },
      { keys: ['↑ / ↓'], description: 'Navigate spans up / down' },
      { keys: ['← / →'], description: 'Collapse / expand selected span' },
      { keys: ['Enter'], description: 'Toggle collapse on selected span' },
      { keys: ['m'], description: 'Toggle mini service map' },
      { keys: ['?'], description: 'Toggle keyboard shortcuts help' },
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
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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

  .toggle-button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .refresh-button {
    border-color: var(--border-strong, var(--border));
    font-variant-numeric: tabular-nums;
  }

  .refresh-split-action {
    position: relative;
    display: inline-flex;
    align-items: stretch;
  }

  .refresh-split-primary {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .refresh-split-toggle {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: none;
    width: 34px;
    min-width: 34px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    text-align: center;
  }

  .refresh-button.auto-refresh-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--selected-bg) 45%, var(--bg-surface));
  }

  .refresh-split-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 210px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow:
      0 8px 20px var(--shadow),
      0 1px 3px var(--shadow-sm);
    z-index: 40;
    overflow: hidden;
  }

  .refresh-split-menu-item {
    width: 100%;
    text-align: left;
    padding: 0.6rem 0.8rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .refresh-split-menu-item:hover {
    background: var(--bg-muted);
  }

  .refresh-button.refresh-needed {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-ring);
  }

  .refresh-button.refresh-alert {
    animation: refreshPulse 1.15s ease-in-out infinite;
  }

  .refresh-button.refresh-alert:not(:hover) {
    background: color-mix(in srgb, var(--selected-bg) 55%, var(--bg-surface));
  }

  .refresh-button.refresh-alert svg {
    animation: refreshNudge 1.15s ease-in-out infinite;
  }

  .refresh-button svg {
    transform-origin: 50% 50%;
  }

  .refresh-button svg.is-spinning {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes refreshPulse {
    0%,
    100% {
      box-shadow:
        inset 0 0 0 1px var(--accent-ring),
        0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent);
    }
    45% {
      box-shadow:
        inset 0 0 0 1px var(--accent-ring),
        0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent);
    }
    55% {
      box-shadow:
        inset 0 0 0 1px var(--accent-ring),
        0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
    }
  }

  @keyframes refreshNudge {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.08);
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .refresh-button.refresh-alert,
    .refresh-button.refresh-alert svg,
    .refresh-button svg.is-spinning {
      animation: none;
    }
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
    content: '';
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

  .sidebar-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .waterfall-container {
    display: grid;
    grid-template-columns: 1fr;
    align-content: start;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow-x: auto;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .waterfall-container:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .waterfall-cell.ruler-cell {
    position: sticky;
    top: 0;
    z-index: 11;
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
    content: '';
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
</style>
