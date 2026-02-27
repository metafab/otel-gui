/**
 * Returns true when the currently focused element accepts text input.
 * Used as a guard to prevent global keyboard shortcuts from firing while the
 * user is typing in a search box, textarea, or contenteditable element.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (el as HTMLElement).isContentEditable
  )
}

/**
 * True when running on macOS. Used to display platform-appropriate key labels
 * (e.g. "Option+Delete" on Mac vs "Alt+Delete" on Windows/Linux).
 * Guarded for SSR environments where navigator is unavailable.
 */
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)
