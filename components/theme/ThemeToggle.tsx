'use client'

import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  const label = theme === 'ink' ? 'Switch to Paper' : 'Switch to Ink'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      data-tip={label}
      data-tip-side="bottom"
      aria-label={label}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
        {theme === 'ink' ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  )
}
