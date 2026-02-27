/**
 * Svelte action: focuses the node on mount.
 * Use: <div use:autoFocus>
 */
export function autoFocus(node: HTMLElement): void {
  node.focus()
}
