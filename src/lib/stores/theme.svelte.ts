// Theme store: 'system' | 'light' | 'dark'
// Persists to localStorage, defaults to 'system' (follows OS preference)

import { browser } from '$app/environment'

type ThemeValue = 'system' | 'light' | 'dark'

function getInitialTheme(): ThemeValue {
  if (!browser) return 'system'
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

let theme = $state<ThemeValue>(getInitialTheme())

if (browser) {
  $effect.root(() => {
    $effect(() => {
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('theme', theme)
    })
  })
}

const CYCLE: ThemeValue[] = ['system', 'light', 'dark']

export const themeStore = {
  get current(): ThemeValue {
    return theme
  },
  set(value: ThemeValue) {
    theme = value
  },
  cycle() {
    const idx = CYCLE.indexOf(theme)
    theme = CYCLE[(idx + 1) % CYCLE.length]
  },
}
