<script lang="ts">
  import { getServiceColor } from "$lib/utils/colors";
  import { themeStore } from "$lib/stores/theme.svelte";

  interface Props {
    serviceName: string;
  }

  let { serviceName }: Props = $props();

  // themeStore.current is a reactive dependency — color updates on theme toggle
  const color = $derived(getServiceColor(serviceName, themeStore.current));
</script>

<span class="service-badge" style="background: {color}" title="Service"
  >{serviceName}</span
>

<style>
  .service-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    color: var(--badge-text);
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.6875rem;
    border: 1px solid rgba(0, 0, 0, 0.12);
  }
</style>
