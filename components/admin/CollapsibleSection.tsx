'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { Icon } from '@/components/studio'

interface CollapsibleSectionProps {
  /** Stable key used to persist open/closed state in localStorage. */
  storageKey: string
  /** Section heading shown above the disclosure caret. */
  label: string
  /** Optional Material Symbols icon next to the label. */
  icon?: string
  /** Default open state if nothing in storage yet. */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A sidebar disclosure section whose open/closed state is persisted per
 * `storageKey` in localStorage so users don't have to re-expand on every page
 * navigation.
 */
export function CollapsibleSection({
  storageKey,
  label,
  icon,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const lsKey = `pib_nav_${storageKey}`
  // Start closed during SSR so client/server markup matches; sync from
  // localStorage on mount.
  const [open, setOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(lsKey)
      if (stored === null) {
        setOpen(defaultOpen)
      } else {
        setOpen(stored === '1')
      }
    } catch {
      setOpen(defaultOpen)
    }
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey])

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(lsKey, next ? '1' : '0')
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors group"
      >
        <span className="flex items-center gap-2">
          {icon ? (
            <Icon name={icon} className="text-[16px] opacity-70" />
          ) : null}
          <span className="eyebrow !text-[9px]">{label}</span>
        </span>
        <Icon
          name="chevron_right"
          className={[
            'text-[18px] transition-transform duration-200',
            hydrated && open ? 'rotate-90' : '',
          ].join(' ')}
        />
      </button>
      <div
        className={[
          'overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out',
          hydrated && open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
        ].join(' ')}
      >
        <div className="space-y-1 pt-1">{children}</div>
      </div>
    </div>
  )
}
