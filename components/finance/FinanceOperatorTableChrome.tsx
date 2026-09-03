'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Status } from '@/components/studio'
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
  surface: string
  className?: string
}

export function FinanceOperatorTableChrome({ density, onDensityChange, surface, className = '' }: Props) {
  const [helpOpen, setHelpOpen] = useState(false)
  const dense = density === 'dense'

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()} data-testid={`finance-table-chrome-${surface}`}>
      <Status>Operator tables</Status>
      <Button type="button" size="sm" variant="secondary" aria-pressed={dense} data-testid={`finance-density-toggle-${surface}`} onClick={() => onDensityChange(nextFinanceTableDensity(density))}>
        {dense ? 'Comfortable rows' : 'Dense rows'}
      </Button>
      <Button type="button" size="sm" variant="secondary" aria-expanded={helpOpen} aria-controls={`finance-shortcuts-${surface}`} data-testid={`finance-shortcuts-toggle-${surface}`} onClick={() => setHelpOpen((v) => !v)}>
        Keyboard shortcuts
      </Button>
      <span className="sc-body text-xs text-[var(--sc-ink-soft)]">Dense mode is desktop-only; mobile cards keep full touch targets.</span>
      {helpOpen ? (
        <div id={`finance-shortcuts-${surface}`} className="st-panel st-panel--flat w-full p-3 text-xs text-[var(--sc-ink)]" role="region" aria-label={`${surface} keyboard shortcuts`}>
          <ul className="grid gap-1 sm:grid-cols-2">
            {FINANCE_OPERATOR_TABLE_SHORTCUTS.map((item) => (
              <li key={item.keys} className="text-[var(--sc-ink-soft)]">
                <kbd className="rounded border border-[var(--sc-line)] px-1 text-[var(--sc-ink)]">{item.keys}</kbd> - {item.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
