<script lang="ts">
  import "./app.css";
  import favicon from "$lib/assets/favicon.svg";
  import logo from "$lib/assets/logo.svg";
  import { themeStore } from "$lib/stores/theme.svelte";

  let { children } = $props();

  const THEME_ICONS: Record<string, string> = {
    system: "⊡",
    light: "☀",
    dark: "☾",
  };
  const THEME_LABELS: Record<string, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };
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
    <button
      class="theme-toggle"
      onclick={() => themeStore.cycle()}
      title="Theme: {THEME_LABELS[themeStore.current]} (click to cycle)"
      aria-label="Toggle theme"
    >
      <span class="theme-icon">{THEME_ICONS[themeStore.current]}</span>
      <span class="theme-label">{THEME_LABELS[themeStore.current]}</span>
    </button>
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
