'use client'

import { useEffect } from 'react'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--color-pib-line)] shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-pib-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-pib-line)]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">keyboard</span>
            <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">Keyboard shortcuts</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-2">
                {section.heading}
              </p>
              <div className="space-y-1">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-[var(--color-pib-text)]">{row.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {row.keys.map((k, ki) => (
                        <kbd
                          key={ki}
                          className="text-[10px] text-[var(--color-pib-text-muted)] bg-white/[0.06] border border-[var(--color-pib-line)] rounded px-1.5 py-0.5 font-mono"
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
