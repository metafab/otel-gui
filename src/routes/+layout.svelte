<script lang="ts">
  import "./app.css";
  import favicon from "$lib/assets/favicon.svg";
  import logo from "$lib/assets/logo.svg";

  let { children } = $props();
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
    background: white;
    border-bottom: 1px solid #e0e0e0;
    padding: 0 24px;
    height: 56px;
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .app-title {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
    font-weight: 600;
    color: #333;
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
</style>
