'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

let listeners: Array<() => void> = []

function subscribe(callback: () => void) {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter((l) => l !== callback)
  }
}

function getSnapshot() {
  return document.documentElement.classList.contains('dark')
}

function getServerSnapshot() {
  return false
}

function setDark(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
  for (const listener of listeners) listener()
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return (
    <button
      type="button"
      onClick={() => setDark(!isDark)}
      aria-label="Toggle light/dark theme"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
