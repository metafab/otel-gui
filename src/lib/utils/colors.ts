// Deterministic pastel color palette for service names
// Avoids red (reserved for error spans)

// Light mode: pastel hues
const COLOR_PALETTE_LIGHT = [
  '#93c5fd', // pastel blue
  '#6ee7b7', // pastel emerald
  '#fcd34d', // pastel amber
  '#c4b5fd', // pastel violet
  '#a5f3fc', // pastel cyan-light
  '#5eead4', // pastel teal
  '#fdba74', // pastel orange
  '#a5b4fc', // pastel indigo
  '#bef264', // pastel lime
  '#67e8f9', // pastel cyan
  '#d8b4fe', // pastel purple
  '#fde047', // pastel yellow
  '#86efac', // pastel green
  '#7dd3fc', // pastel sky
  '#ddd6fe', // pastel lavender
  '#99f6e4', // pastel teal-light
]

// Dark mode: deep/700-shade hues — all dark enough for white (#e2e8f0) text
const COLOR_PALETTE_DARK = [
  '#2563eb', // blue-600
  '#047857', // emerald-700
  '#b45309', // amber-700
  '#6d28d9', // violet-700
  '#0e7490', // cyan-700
  '#0f766e', // teal-700
  '#c2410c', // orange-700
  '#4338ca', // indigo-700
  '#4d7c0f', // lime-700
  '#0891b2', // cyan-600
  '#7e22ce', // purple-700
  '#a16207', // yellow-700
  '#15803d', // green-700
  '#0369a1', // sky-700
  '#5b21b6', // violet-800
  '#0d9488', // teal-600
]

// Simple hash function for strings
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

// Resolve whether effective theme is dark given the stored preference string.
// Accepts the value from themeStore.current so callers can create a reactive
// dependency — do NOT call document.documentElement directly here.
function resolveIsDark(theme: string): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  // 'system' — fall back to OS preference
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

// Get color for service name (deterministic, theme-aware).
// Pass themeStore.current so that $derived in components tracks theme changes.
export function getServiceColor(serviceName: string, theme = 'system'): string {
  const dark = resolveIsDark(theme)
  if (!serviceName) {
    return dark ? '#475569' : '#d1d5db'
  }

  const index = hashString(serviceName) % COLOR_PALETTE_LIGHT.length
  return dark ? COLOR_PALETTE_DARK[index] : COLOR_PALETTE_LIGHT[index]
}

// Get all service names from spans and create color map
export function createServiceColorMap(
  serviceNames: string[],
  theme = 'system',
): Map<string, string> {
  const colorMap = new Map<string, string>()

  for (const serviceName of serviceNames) {
    if (!colorMap.has(serviceName)) {
      colorMap.set(serviceName, getServiceColor(serviceName, theme))
    }
  }

  return colorMap
}
