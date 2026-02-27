<script lang="ts">
  interface Props {
    /** Whether the chevron points down (expanded). Default: false (points right = collapsed). */
    expanded?: boolean
    /** Size in pixels. Default: 12 */
    size?: number
  }

  let { expanded = false, size = 12 }: Props = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 12 12"
  fill="none"
  aria-hidden="true"
  style:transform={expanded ? 'rotate(90deg)' : 'rotate(0deg)'}
  style:transition="transform 0.15s ease"
  style:flex-shrink="0"
>
  <path
    d="M4 2l4 4-4 4"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
