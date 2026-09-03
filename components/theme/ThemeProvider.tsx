'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

/** Paper = default (no data-theme). Ink = data-theme="ink". */
export type Theme = 'paper' | 'ink'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'paper',
  toggleTheme: () => {},
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

function applyTheme(next: Theme) {
  if (next === 'ink') {
    document.documentElement.setAttribute('data-theme', 'ink')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

/** One-time migration: dark→ink, light→paper (cleared). */
function readStoredTheme(): Theme {
  const stored = localStorage.getItem('pib-theme')
  if (stored === 'ink' || stored === 'dark') {
    if (stored === 'dark') localStorage.setItem('pib-theme', 'ink')
    return 'ink'
  }
  if (stored === 'light' || stored === 'paper') {
    if (stored === 'light') localStorage.setItem('pib-theme', 'paper')
    return 'paper'
  }
  return 'paper'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('paper')

  useEffect(() => {
    const resolved = readStoredTheme()
    setTheme(resolved)
    applyTheme(resolved)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'ink' ? 'paper' : 'ink'
      localStorage.setItem('pib-theme', next)
      applyTheme(next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
