'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import {
  FINANCE_OPERATOR_TABLE_SHORTCUTS,
  nextFinanceTableDensity,
  readStoredFinanceTableDensity,
  writeStoredFinanceTableDensity,
  type FinanceTableDensity,
} from '@/lib/finance/operator-table-a11y'

export function useFinanceTableDensity(defaultDensity: FinanceTableDensity = 'comfortable') {
  const [density, setDensityState] = useState<FinanceTableDensity>(defaultDensity)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDensityState(readStoredFinanceTableDensity(typeof window !== 'undefined' ? window.localStorage : null))
    setReady(true)
  }, [])

  function setDensity(next: FinanceTableDensity) {
    setDensityState(next)
    writeStoredFinanceTableDensity(typeof window !== 'undefined' ? window.localStorage : null, next)
  }

  function toggleDensity() {
    setDensity(nextFinanceTableDensity(density))
  }

  return { density, setDensity, toggleDensity, ready }
}

type Props = {
  density: FinanceTableDensity
  onDensityChange: (next: FinanceTableDensity) => void
  /** Short surface name for testids / labels (documents | ledger | bank-feeds). */
  surface: string
  className?: string
}

/**
 * Dense-mode toggle + keyboard shortcut legend for finance operator lists.
 * Dense mode only tightens desktop table cells; mobile card layout stays touch-friendly.
 */
export function FinanceOperatorTableChrome({ density, onDensityChange, surface, className = '' }: Props) {
  const [helpOpen, setHelpOpen] = useState(false)
  const dense = density === 'dense'

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`.trim()}
      data-testid={`finance-table-chrome-${surface}`}
    >
      <HudChip tone="neutral">Operator tables</HudChip>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-pressed={dense}
        data-testid={`finance-density-toggle-${surface}`}
        onClick={() => onDensityChange(nextFinanceTableDensity(density))}
      >
        {dense ? 'Comfortable rows' : 'Dense rows'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-expanded={helpOpen}
        aria-controls={`finance-shortcuts-${surface}`}
        data-testid={`finance-shortcuts-toggle-${surface}`}
        onClick={() => setHelpOpen((v) => !v)}
      >
        Keyboard shortcuts
      </Button>
      <span className="text-xs text-[var(--color-pib-text-muted)]">
        Dense mode is desktop-only; mobile cards keep full touch targets.
      </span>
      {helpOpen ? (
        <div
          id={`finance-shortcuts-${surface}`}
          className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3 text-xs text-[var(--color-pib-text)]"
          role="region"
          aria-label={`${surface} keyboard shortcuts`}
        >
          <ul className="grid gap-1 sm:grid-cols-2">
            {FINANCE_OPERATOR_TABLE_SHORTCUTS.map((item) => (
              <li key={item.keys} className="text-[var(--color-pib-text-muted)]">
                <kbd className="rounded border border-[var(--color-pib-line)] px-1 text-[var(--color-pib-text)]">
                  {item.keys}
                </kbd>{' '}
                — {item.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
