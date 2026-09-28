<script lang="ts">
  // Test double for UplotChart: renders each plotted series' label and its last
  // non-null value as text so component tests can assert what was plotted,
  // without loading uPlot/canvas in jsdom.
  interface Props {
    data: (number | null)[][]
    series: { label: string }[]
  }

  let { data, series }: Props = $props()

  function lastValue(col: (number | null)[] | undefined): string {
    if (!col) return ''
    for (let i = col.length - 1; i >= 0; i--) {
      if (col[i] !== null && col[i] !== undefined) return String(col[i])
    }
    return ''
  }
</script>

<div data-testid="uplot-mock">
  {#each series as s, i (s.label)}
    <span class="plotted-series">{s.label}:{lastValue(data[i + 1])}</span>
  {/each}
</div>
