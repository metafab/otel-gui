<script lang="ts">
  import { checkForUpdate, dismissUpdate } from '$lib/utils/updateCheck'

  interface Props {
    currentVersion?: string
  }

  let { currentVersion = import.meta.env.PACKAGE_VERSION }: Props = $props()

  let latestVersion = $state<string | null>(null)
  let updateDismissed = $state(false)

  function handleDismissUpdate() {
    if (latestVersion) {
      dismissUpdate(latestVersion)
    }
    updateDismissed = true
  }

  $effect(() => {
    checkForUpdate(currentVersion).then((tag) => {
      if (tag) {
        latestVersion = tag
        updateDismissed = false
      }
    })
  })
</script>

<span class="update-notice" role="status">
  <span class="current-version">v{currentVersion}</span>
  {#if latestVersion && !updateDismissed}
    <span class="update-available">
      → v{latestVersion} available —
      <a
        href="https://github.com/metafab/otel-gui/releases"
        target="_blank"
        rel="noopener noreferrer">release notes</a
      >
      <button
        class="update-dismiss"
        onclick={handleDismissUpdate}
        aria-label="Dismiss update notice"
        title="Dismiss">[×]</button
      >
    </span>
  {/if}
</span>

<style>
  @keyframes update-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }

  .update-notice {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .current-version {
    color: var(--text-muted);
  }

  .update-available {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    animation: update-blink 1.2s ease-in-out 1;
  }

  .update-notice a {
    color: var(--accent);
    text-decoration: none;
  }

  .update-notice a:hover {
    text-decoration: underline;
  }

  .update-dismiss {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font-size: 0.75rem;
    line-height: 1;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .update-dismiss:hover {
    color: var(--text-secondary);
  }
</style>
