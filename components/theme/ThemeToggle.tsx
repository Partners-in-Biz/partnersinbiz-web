'use client'

import { useTheme } from './ThemeProvider'
import { Icon } from '@/components/studio'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  const nextLabel = theme === 'ink' ? 'Paper' : 'Ink'
  const label = `Switch to ${nextLabel}`

  return (
    <button
      type="button"
      onClick={toggleTheme}
      data-tip={label}
      data-tip-side="bottom"
      aria-label={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-1.5 text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
    >
      <Icon name={theme === 'ink' ? 'light_mode' : 'dark_mode'} />
      <span className="sc-tiny hidden sm:inline">{theme === 'ink' ? 'Ink' : 'Paper'}</span>
    </button>
  )
}
