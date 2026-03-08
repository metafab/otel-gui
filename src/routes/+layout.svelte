<script lang="ts">
  import './app.css'
  import favicon from '$lib/assets/favicon.svg'
  import logo from '$lib/assets/logo.svg'
  import { themeStore } from '$lib/stores/theme.svelte'

  let { children } = $props()

  const THEME_ICONS: Record<string, string> = {
    system: '⊡',
    light: '☀',
    dark: '☾',
  }
  const THEME_LABELS: Record<string, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
  <header class="app-header">
    <a href="/" class="app-title">
      <img src={logo} alt="" class="app-logo" />
      <span>otel-gui</span>
    </a>
    <div class="header-actions">
      <a
        href="https://github.com/metafab/otel-gui"
        target="_blank"
        rel="noopener noreferrer"
        class="github-link"
        title="View on GitHub"
        aria-label="View on GitHub"
      >
        <svg
          viewBox="0 0 16 16"
          width="18"
          height="18"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>GitHub</span>
      </a>
      <button
        class="theme-toggle"
        onclick={() => themeStore.cycle()}
        title="Theme: {THEME_LABELS[themeStore.current]} (click to cycle)"
        aria-label="Toggle theme"
      >
        <span class="theme-icon">{THEME_ICONS[themeStore.current]}</span>
        <span class="theme-label">{THEME_LABELS[themeStore.current]}</span>
      </button>
    </div>
  </header>
  <main class="app-main">
    {@render children()}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-header {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 1px 3px var(--shadow-sm);
  }

  .app-title {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    text-decoration: none;
    transition: opacity 0.2s;
  }

  .app-title:hover {
    opacity: 0.8;
    text-decoration: none;
  }

  .app-logo {
    width: 28px;
    height: 28px;
  }

  .app-main {
    flex: 1;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    text-decoration: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .github-link:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
    color: var(--accent);
    text-decoration: none;
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
    user-select: none;
  }

  .theme-toggle:hover {
    background: var(--bg-muted);
    border-color: var(--accent);
    color: var(--accent);
  }

  .theme-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .theme-label {
    font-weight: 500;
  }
</style>
