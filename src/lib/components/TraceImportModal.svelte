<script lang="ts">
  import { autoFocus } from '$lib/actions/autoFocus'
  import type { TraceImportPreview } from '$lib/types'

  interface ImportResult {
    importedTraceCount: number
    importedSpanCount: number
  }

  interface Props {
    onclose: () => void
    onimported: (result: ImportResult) => void
  }

  let { onclose, onimported }: Props = $props()

  let selectedFile = $state<File | null>(null)
  let fileContent = $state<string | null>(null)
  let preview = $state<TraceImportPreview | null>(null)
  let error = $state<string | null>(null)
  let isPreviewLoading = $state(false)
  let isImporting = $state(false)

  function formatBytes(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`
    if (sizeBytes < 1024 * 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatExportedAt(value: string | null): string {
    if (!value) return 'not provided'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }

    return parsed.toLocaleString()
  }

  async function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0] ?? null

    if (!file) return

    selectedFile = file
    preview = null
    error = null

    try {
      fileContent = await file.text()
      await handlePreview()
    } catch {
      fileContent = null
      error = 'Could not read the selected file.'
    }
  }

  async function handlePreview() {
    if (!selectedFile || !fileContent) return

    isPreviewLoading = true
    error = null

    try {
      const response = await fetch('/api/traces/import/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          content: fileContent,
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Could not preview import file')
      }

      preview = payload
    } catch (err) {
      preview = null
      error =
        err instanceof Error ? err.message : 'Could not preview import file'
    } finally {
      isPreviewLoading = false
    }
  }

  async function handleImport() {
    if (!selectedFile || !fileContent || !preview) return

    isImporting = true
    error = null

    try {
      const response = await fetch('/api/traces/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          content: fileContent,
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Could not import traces')
      }

      onimported({
        importedTraceCount: payload.importedTraceCount,
        importedSpanCount: payload.importedSpanCount,
      })
      onclose()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not import traces'
    } finally {
      isImporting = false
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onclose()
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Import traces">
  <button class="backdrop" onclick={onclose} aria-label="Close" tabindex="-1"
  ></button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" tabindex="-1" onkeydown={handleKeydown} use:autoFocus>
    <div class="modal-header">
      <span class="modal-title">Import Traces</span>
      <button class="close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      <label class="file-picker">
        <span class="file-picker-label">JSON file</span>
        <span class="choose-file-btn">Choose file</span>
        <input
          class="file-input-hidden"
          type="file"
          accept="application/json,.json"
          onchange={handleFileChange}
        />
      </label>

      {#if selectedFile}
        <div class="selected-file">
          <div class="selected-file-name">{selectedFile.name}</div>
          <div class="selected-file-meta">{formatBytes(selectedFile.size)}</div>
        </div>
      {/if}

      {#if error}
        <div class="error-box">{error}</div>
      {/if}

      {#if preview}
        <section class="preview-card">
          <div class="preview-header">Preview before import</div>
          <dl class="preview-grid">
            <div>
              <dt>Format</dt>
              <dd>{preview.format}</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{formatBytes(preview.sizeBytes)}</dd>
            </div>
            <div class="full-row">
              <dt>Exported at</dt>
              <dd title={preview.exportedAt || undefined}>
                {formatExportedAt(preview.exportedAt)}
              </dd>
            </div>
            <div class="full-row split-metrics">
              <div>
                <dt>Traces</dt>
                <dd>{preview.traceCount}</dd>
              </div>
              <div>
                <dt>Spans</dt>
                <dd>{preview.spanCount}</dd>
              </div>
            </div>
            <div class="full-row services-row">
              <dt>Services</dt>
              <dd>
                {#if preview.services.length > 0}
                  {preview.services.join(', ')}
                {:else}
                  unknown
                {/if}
              </dd>
            </div>
          </dl>

          {#if preview.warnings.length > 0}
            <div class="warnings-box">
              {#each preview.warnings as warning}
                <p>{warning}</p>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>

    <div class="modal-footer">
      <button
        class="secondary-btn"
        onclick={onclose}
        disabled={isPreviewLoading || isImporting}
      >
        Cancel
      </button>
      <button
        class="primary-btn"
        onclick={handleImport}
        disabled={!preview || isPreviewLoading || isImporting}
      >
        {isPreviewLoading
          ? 'Preparing preview...'
          : isImporting
            ? 'Importing...'
            : 'Confirm Import'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(560px, 92vw);
    max-height: 85vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow:
      0 8px 32px var(--shadow),
      0 2px 8px var(--shadow-sm);
    outline: none;
  }

  .modal-header,
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-code);
    flex-shrink: 0;
  }

  .modal-footer {
    border-top: 1px solid var(--border);
    border-bottom: none;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .modal-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn,
  .secondary-btn,
  .primary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition:
      background 0.1s ease,
      color 0.1s ease,
      border-color 0.1s ease;
  }

  .close-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .close-btn:hover {
    background: var(--error-bg);
    border-color: var(--error-text);
    color: var(--error-text);
  }

  .modal-body {
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .file-picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .file-picker-label {
    font-weight: 600;
    color: var(--text-primary);
  }

  .file-input-hidden {
    display: none;
  }

  .choose-file-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.4rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
    user-select: none;
  }

  .file-picker:hover .choose-file-btn {
    background: var(--bg-muted);
  }

  .selected-file,
  .preview-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.9rem 1rem;
    background: var(--bg-page);
  }

  .selected-file-name,
  .preview-header {
    font-weight: 600;
    color: var(--text-primary);
  }

  .selected-file-meta {
    margin-top: 0.25rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .preview-grid {
    margin: 0.75rem 0 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem 1rem;
  }

  .preview-grid div {
    min-width: 0;
  }

  .preview-grid dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 0.2rem;
  }

  .preview-grid dd {
    margin: 0;
    color: var(--text-primary);
    font-family: monospace;
    overflow-wrap: anywhere;
  }

  .services-row {
    grid-column: 1 / -1;
  }

  .full-row {
    grid-column: 1 / -1;
  }

  .split-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem 1rem;
  }

  .error-box,
  .warnings-box {
    padding: 0.75rem 0.9rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .error-box {
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error-text);
  }

  .warnings-box {
    margin-top: 0.9rem;
    background: var(--selected-bg);
    border: 1px solid var(--accent-ring);
    color: var(--text-secondary);
  }

  .warnings-box p {
    margin: 0;
  }

  .warnings-box p + p {
    margin-top: 0.4rem;
  }

  .secondary-btn,
  .primary-btn {
    min-width: 126px;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--border);
  }

  .secondary-btn {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .primary-btn {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .secondary-btn:hover:not(:disabled) {
    background: var(--bg-muted);
  }

  .primary-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }

  .secondary-btn:disabled,
  .primary-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (max-width: 640px) {
    .preview-grid {
      grid-template-columns: 1fr;
    }

    .split-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
