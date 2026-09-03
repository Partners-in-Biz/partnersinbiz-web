'use client'

import { useState } from 'react'

type ClientVisibilityToggleProps = {
  /** Current visibility. Unset = shared. */
  value?: 'shared' | 'private' | null
  /** Linked org display name for the Shared label. */
  linkedOrgName?: string
  /** Persist callback - parent owns the API call. */
  onChange: (next: 'shared' | 'private') => Promise<void> | void
  disabled?: boolean
  className?: string
}

/**
 * Shown on company-scoped records when the company is linked.
 * Default is Shared with {org}; Keep private withholds from projection.
 */
export function ClientVisibilityToggle({
  value,
  linkedOrgName,
  onChange,
  disabled = false,
  className = '',
}: ClientVisibilityToggleProps) {
  const [busy, setBusy] = useState(false)
  const current = value === 'private' ? 'private' : 'shared'
  const sharedLabel = linkedOrgName ? `Shared with ${linkedOrgName}` : 'Shared with linked org'

  async function setNext(next: 'shared' | 'private') {
    if (disabled || busy || next === current) return
    setBusy(true)
    try {
      await onChange(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] bg-black/20 p-0.5 text-[11px] ${className}`}
      role="group"
      aria-label="Client visibility"
    >
      <button
        type="button"
        disabled={disabled || busy}
        aria-pressed={current === 'shared'}
        onClick={() => void setNext('shared')}
        className={`rounded-md px-2.5 py-1 transition ${
          current === 'shared'
            ? 'bg-[var(--color-accent-v2)]/20 text-[var(--color-pib-text)]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'
        } disabled:opacity-50`}
      >
        {sharedLabel}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        aria-pressed={current === 'private'}
        onClick={() => void setNext('private')}
        className={`rounded-md px-2.5 py-1 transition ${
          current === 'private'
            ? 'bg-white/10 text-[var(--color-pib-text)]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'
        } disabled:opacity-50`}
      >
        Keep private
      </button>
    </div>
  )
}
