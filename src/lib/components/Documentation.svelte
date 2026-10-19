<script lang="ts">
  import Readme from '../../../README.md'
  import HttpApi from '../../../docs/http-api.md'

  interface Props {
    document: 'readme' | 'http-api'
  }

  let { document }: Props = $props()
</script>

<svelte:head>
  <title>
    {document === 'readme' ? 'Documentation' : 'HTTP API'} · otel-gui
  </title>
  <meta
    name="description"
    content={document === 'readme'
      ? 'otel-gui overview, setup instructions, and project guide.'
      : 'Agent-facing reference for the otel-gui HTTP API.'}
  />
</svelte:head>

<div class="docs-page">
  <nav class="docs-nav" aria-label="Documentation">
    <a
      href="/docs"
      aria-current={document === 'readme' ? 'page' : undefined}
      class:active={document === 'readme'}>Overview</a
    >
    <a
      href="/docs/http-api"
      aria-current={document === 'http-api' ? 'page' : undefined}
      class:active={document === 'http-api'}>HTTP API</a
    >
  </nav>

  <article class="markdown-content">
    {#if document === 'readme'}
      <Readme />
    {:else}
      <HttpApi />
    {/if}
  </article>
</div>

<style>
  .docs-page {
    width: min(100% - 32px, 1120px);
    margin: 24px auto 64px;
  }

  .docs-nav {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .docs-nav a {
    display: inline-block;
    padding: 10px 14px;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .docs-nav a:hover,
  .docs-nav a.active {
    color: var(--accent);
  }

  .docs-nav a.active {
    border-bottom-color: var(--accent);
  }

  .markdown-content {
    color: var(--text-primary);
    line-height: 1.65;
    overflow-wrap: anywhere;
  }

  .markdown-content :global(h1),
  .markdown-content :global(h2),
  .markdown-content :global(h3),
  .markdown-content :global(h4) {
    color: var(--text-primary);
    line-height: 1.25;
    margin-top: 1.75em;
    margin-bottom: 0.5em;
    scroll-margin-top: 72px;
  }

  .markdown-content :global(h1) {
    border-bottom: 1px solid var(--border);
    font-size: 2rem;
    padding-bottom: 0.35em;
  }

  .markdown-content :global(p),
  .markdown-content :global(li) {
    color: var(--text-secondary);
  }

  .markdown-content :global(img) {
    height: auto;
    max-width: 100%;
  }

  .markdown-content :global(pre) {
    overflow-x: auto;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-code);
    line-height: 1.5;
  }

  .markdown-content :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.875em;
  }

  .markdown-content :global(:not(pre) > code) {
    padding: 0.15em 0.35em;
    border-radius: 4px;
    background: var(--bg-muted);
  }

  .markdown-content :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    padding: 8px 12px;
    border: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  .markdown-content :global(th) {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
</style>
