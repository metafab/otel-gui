<script lang="ts">
  import type {
    ExpHistogramPoint,
    HistogramPoint,
    MetricScalarWirePoint,
    MetricSeriesDetail,
    SummaryPoint,
    MetricType,
    MetricWirePoint,
  } from '#lib/types.js'
  import InlineAttributeChips from '#lib/components/InlineAttributeChips.svelte'
  import type { ValueMode } from '#lib/utils/metricChart.js'
  import { formatDateTimeLocal } from '#lib/utils/time.js'

  const PAGE_SIZE = 25

  interface Props {
    type: MetricType
    unit: string
    series: MetricSeriesDetail[]
    valueMode: ValueMode
  }

  let { type, unit, series, valueMode }: Props = $props()
  let currentPage = $state(0)

  const rows = $derived.by(() =>
    series
      .flatMap((item) =>
        item.points.map((point, index) => ({
          key: `${item.seriesId}:${point.t}:${index}`,
          attributes: item.attributes,
          point,
          index,
        })),
      )
      .filter(
        ({ point }) => type !== 'sum' || valueMode !== 'rate' || hasRate(point),
      )
      .sort((a, b) => b.point.t - a.point.t || a.index - b.index),
  )
  const pageCount = $derived(Math.max(1, Math.ceil(rows.length / PAGE_SIZE)))
  const pageRows = $derived(
    rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
  )
  const rangeStart = $derived(
    rows.length === 0 ? 0 : currentPage * PAGE_SIZE + 1,
  )
  const rangeEnd = $derived(
    Math.min((currentPage + 1) * PAGE_SIZE, rows.length),
  )

  $effect(() => {
    if (currentPage >= pageCount) currentPage = pageCount - 1
  })

  function hasRate(
    point: MetricWirePoint,
  ): point is MetricScalarWirePoint & { rate: number } {
    return 'rate' in point && typeof point.rate === 'number'
  }

  function isScalar(point: MetricWirePoint): point is MetricScalarWirePoint {
    return 'v' in point && typeof point.v === 'number'
  }

  function isHistogram(point: MetricWirePoint): point is HistogramPoint {
    return 'bucketCounts' in point && 'explicitBounds' in point
  }

  function isExpHistogram(point: MetricWirePoint): point is ExpHistogramPoint {
    return 'scale' in point && 'positive' in point && 'negative' in point
  }

  function isSummary(point: MetricWirePoint): point is SummaryPoint {
    return 'quantileValues' in point && Array.isArray(point.quantileValues)
  }

  function formatQuantile(quantile: number): string {
    const percentage = quantile * 100
    return `p${Number.isInteger(percentage) ? percentage : Number(percentage.toFixed(3))}`
  }

  function formatBucketRange(index: number, bounds: number[]): string {
    const lower = index === 0 ? '-∞' : String(bounds[index - 1])
    const upper = index === bounds.length ? '∞' : String(bounds[index])
    return `${lower}…${upper}`
  }

  function formatBuckets(buckets: {
    offset: number
    bucketCounts: number[]
  }): string {
    return (
      buckets.bucketCounts
        .map((count, index) => `${buckets.offset + index}: ${count}`)
        .join(', ') || 'none'
    )
  }
</script>

<section class="datapoints" aria-labelledby="datapoints-title">
  <div class="section-header">
    <h3 id="datapoints-title">Datapoints</h3>
    {#if rows.length > 0}
      <span class="row-count" data-testid="datapoint-count">
        Showing {rangeStart}–{rangeEnd} of {rows.length}
      </span>
    {/if}
  </div>

  {#if rows.length === 0}
    <p class="empty-inline">No datapoints in the currently displayed series.</p>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Timestamp</th>
            <th scope="col">Attributes</th>
            <th scope="col">Datapoint</th>
          </tr>
        </thead>
        <tbody>
          {#each pageRows as row (row.key)}
            <tr>
              <td class="timestamp" title={new Date(row.point.t).toISOString()}>
                <time datetime={new Date(row.point.t).toISOString()}>
                  {formatDateTimeLocal(row.point.t)}
                </time>
              </td>
              <td class="attributes">
                {#if Object.keys(row.attributes).length > 0}
                  <InlineAttributeChips attributes={row.attributes} />
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td class="point-details">
                {#if type === 'gauge' || type === 'sum'}
                  {#if isScalar(row.point)}
                    <span class="detail">
                      <strong
                        >{type === 'sum' && valueMode === 'rate'
                          ? 'Rate'
                          : 'Value'}</strong
                      >
                      {#if type === 'sum' && valueMode === 'rate' && hasRate(row.point)}
                        {row.point.rate} {unit}/s
                      {:else}
                        {row.point.v} {unit}
                      {/if}
                    </span>
                  {/if}
                {:else if type === 'histogram' && isHistogram(row.point)}
                  <span class="detail"
                    ><strong>Count</strong> {row.point.count}</span
                  >
                  {#if row.point.sum !== undefined}
                    <span class="detail"
                      ><strong>Sum</strong> {row.point.sum} {unit}</span
                    >
                  {/if}
                  {#if row.point.min !== undefined}
                    <span class="detail"
                      ><strong>Min</strong> {row.point.min} {unit}</span
                    >
                  {/if}
                  {#if row.point.max !== undefined}
                    <span class="detail"
                      ><strong>Max</strong> {row.point.max} {unit}</span
                    >
                  {/if}
                  <div class="bucket-list">
                    {#each row.point.bucketCounts as count, index (index)}
                      <span
                        >{formatBucketRange(index, row.point.explicitBounds)}: {count}</span
                      >
                    {/each}
                  </div>
                {:else if type === 'exp_histogram' && isExpHistogram(row.point)}
                  <span class="detail"
                    ><strong>Count</strong> {row.point.count}</span
                  >
                  <span class="detail"
                    ><strong>Scale</strong> {row.point.scale}</span
                  >
                  <span class="detail"
                    ><strong>Zero count</strong> {row.point.zeroCount}</span
                  >
                  {#if row.point.sum !== undefined}
                    <span class="detail"
                      ><strong>Sum</strong> {row.point.sum} {unit}</span
                    >
                  {/if}
                  {#if row.point.min !== undefined}
                    <span class="detail"
                      ><strong>Min</strong> {row.point.min} {unit}</span
                    >
                  {/if}
                  {#if row.point.max !== undefined}
                    <span class="detail"
                      ><strong>Max</strong> {row.point.max} {unit}</span
                    >
                  {/if}
                  <span class="detail"
                    ><strong>Positive buckets</strong>
                    {formatBuckets(row.point.positive)}</span
                  >
                  <span class="detail"
                    ><strong>Negative buckets</strong>
                    {formatBuckets(row.point.negative)}</span
                  >
                {:else if type === 'summary' && isSummary(row.point)}
                  <span class="detail"
                    ><strong>Count</strong> {row.point.count}</span
                  >
                  <span class="detail"
                    ><strong>Sum</strong> {row.point.sum} {unit}</span
                  >
                  <div class="bucket-list">
                    {#each row.point.quantileValues as item (item.quantile)}
                      <span
                        >{formatQuantile(item.quantile)}: {item.value}
                        {unit}</span
                      >
                    {/each}
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if pageCount > 1}
      <nav class="pagination" aria-label="Datapoint pages">
        <button
          type="button"
          class="action-button"
          aria-label="Previous datapoints page"
          disabled={currentPage === 0}
          onclick={() => (currentPage -= 1)}>Previous</button
        >
        <span>Page {currentPage + 1} of {pageCount}</span>
        <button
          type="button"
          class="action-button"
          aria-label="Next datapoints page"
          disabled={currentPage >= pageCount - 1}
          onclick={() => (currentPage += 1)}>Next</button
        >
      </nav>
    {/if}
  {/if}
</section>

<style>
  .datapoints {
    margin-top: 1.25rem;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }

  .section-header,
  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h3 {
    margin: 0;
    font-size: 0.9375rem;
  }

  .row-count,
  .pagination {
    color: var(--text-secondary);
    font-size: 0.75rem;
  }

  .table-scroll {
    margin-top: 0.75rem;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  th,
  td {
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .timestamp {
    min-width: 190px;
    white-space: nowrap;
    font-family: monospace;
    color: var(--text-secondary);
  }

  .attributes {
    min-width: 180px;
  }

  .point-details,
  .bucket-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.375rem;
  }

  .detail,
  .bucket-list span {
    overflow-wrap: anywhere;
  }

  .detail strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .bucket-list {
    flex-basis: 100%;
  }

  .muted,
  .empty-inline {
    color: var(--text-muted);
  }

  .empty-inline {
    margin: 0.75rem 0 0;
    font-size: 0.8125rem;
  }

  .pagination {
    justify-content: center;
    margin-top: 0.75rem;
  }

  @media (max-width: 860px) {
    th,
    td {
      padding: 0.5rem;
    }
  }
</style>
