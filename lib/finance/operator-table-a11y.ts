/**
 * Shared a11y / density helpers for high-frequency finance operator tables
 * (documents, ledger, bank recon). Design-system token contrast only — no ad-hoc colours.
 */

export type FinanceTableDensity = 'comfortable' | 'dense'

export const FINANCE_TABLE_DENSITY_STORAGE_KEY = 'pib.finance.tableDensity.v1'

/** CSS custom properties that must back operator table text / borders / surfaces. */
export const FINANCE_TABLE_REQUIRED_CSS_TOKENS = [
  '--color-pib-text',
  '--color-pib-text-muted',
  '--color-pib-line',
  '--color-pib-surface',
] as const

export type FinanceTableKeyboardAction =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'toggle'
  | 'density'
  | 'help'

export const FINANCE_OPERATOR_TABLE_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: '↑ / ↓ or j / k', action: 'Move row focus' },
  { keys: 'Home / End', action: 'Jump to first / last row' },
  { keys: 'Space / Enter', action: 'Toggle row selection (when selectable)' },
  { keys: 'd', action: 'Toggle dense table mode (desktop density; mobile cards unchanged)' },
  { keys: '?', action: 'Show or hide keyboard shortcut help' },
]

export function parseFinanceTableDensity(raw: unknown): FinanceTableDensity {
  return raw === 'dense' ? 'dense' : 'comfortable'
}

export function nextFinanceTableDensity(current: FinanceTableDensity): FinanceTableDensity {
  return current === 'dense' ? 'comfortable' : 'dense'
}

export function financeTableRowTabIndex(index: number, activeIndex: number): number {
  return index === activeIndex ? 0 : -1
}

export function moveFinanceTableFocus(activeIndex: number, rowCount: number, delta: number): number {
  if (rowCount <= 0) return 0
  return Math.max(0, Math.min(rowCount - 1, activeIndex + delta))
}

export function resolveFinanceTableKeyboardAction(event: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}): FinanceTableKeyboardAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const target = event.target as HTMLElement | null | undefined
  if (target) {
    const tag = (target.tagName || '').toLowerCase()
    const editable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target.isContentEditable === true
    // Allow arrows inside the table shell, but never steal typing from form fields.
    if (editable && event.key !== 'Escape') {
      if (event.key === 'd' || event.key === '?' || event.key === 'j' || event.key === 'k') return null
    }
  }

  switch (event.key) {
    case 'ArrowDown':
    case 'j':
      return 'next'
    case 'ArrowUp':
    case 'k':
      return 'prev'
    case 'Home':
      return 'first'
    case 'End':
      return 'last'
    case ' ':
    case 'Enter':
      return 'toggle'
    case 'd':
      return 'density'
    case '?':
      return 'help'
    default:
      return null
  }
}

export function readStoredFinanceTableDensity(
  storage: { getItem(key: string): string | null } | null | undefined,
): FinanceTableDensity {
  if (!storage) return 'comfortable'
  try {
    return parseFinanceTableDensity(storage.getItem(FINANCE_TABLE_DENSITY_STORAGE_KEY))
  } catch {
    return 'comfortable'
  }
}

export function writeStoredFinanceTableDensity(
  storage: { setItem(key: string, value: string): void } | null | undefined,
  density: FinanceTableDensity,
): void {
  if (!storage) return
  try {
    storage.setItem(FINANCE_TABLE_DENSITY_STORAGE_KEY, density)
  } catch {
    // private mode / quota — density still works in-session
  }
}
