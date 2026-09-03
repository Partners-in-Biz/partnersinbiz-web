'use client'

import { useEffect } from 'react'
import { Icon } from '@/components/studio'

interface ShortcutsCheatSheetProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  keys: string[]
  label: string
}

const SECTIONS: { heading: string; rows: ShortcutRow[] }[] = [
  {
    heading: 'General',
    rows: [
      { keys: ['⌘', 'K'], label: 'Open command palette / search' },
      { keys: ['⌘', 'S'], label: 'Save (on pages with a form)' },
      { keys: ['?'], label: 'Open this shortcuts sheet' },
      { keys: ['Esc'], label: 'Close / dismiss' },
    ],
  },
  {
    heading: 'Go to (press G, then…)',
    rows: [
      { keys: ['G', 'D'], label: 'Dashboard' },
      { keys: ['G', 'C'], label: 'CRM / contacts' },
      { keys: ['G', 'E'], label: 'Email' },
      { keys: ['G', 'S'], label: 'Social' },
      { keys: ['G', 'O'], label: 'Organisation settings' },
    ],
  },
]

export function ShortcutsCheatSheet({ open, onClose }: ShortcutsCheatSheetProps) {
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--st-radius-raised)] bg-[var(--sc-surface)] text-[var(--sc-ink)]"
        style={{ boxShadow: 'var(--sc-shadow), inset 0 0 0 1px var(--sc-edge-light, var(--sc-line))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="shortcuts-sheet-title"
      >
        <div className="flex items-center justify-between px-5 min-h-11 border-b border-[var(--sc-line)]">
          <div className="flex items-center gap-2">
            <Icon name="keyboard" className="text-[var(--sc-ink-soft)]" />
            <h2 id="shortcuts-sheet-title" className="st-title m-0">Keyboard shortcuts.</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="sc-tiny text-[var(--sc-ink-soft)] mb-2 m-0">
                {section.heading}
              </p>
              <div className="space-y-1">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between min-h-11 py-1">
                    <span className="sc-body text-[0.875rem] text-[var(--sc-ink)]">{row.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {row.keys.map((k, ki) => (
                        <kbd
                          key={ki}
                          className="sc-tiny text-[var(--sc-ink-soft)] border border-[var(--sc-line)] rounded-[var(--st-radius)] px-1.5 py-0.5"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
