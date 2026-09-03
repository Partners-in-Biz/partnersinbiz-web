'use client'

import { useMemo, useState } from 'react'
import {
  COMPANY_WORKSPACE_MODULES,
  DEFAULT_COMPANY_WORKSPACE_MODULES,
} from '@/lib/company-work/module-keys'

type PartnerModuleMatrixProps = {
  value?: string[]
  defaultValue?: string[]
  onChange?: (modules: string[]) => void
  /** When true, matrix is display-only. */
  readOnly?: boolean
  label?: string
  className?: string
}

/**
 * Relationship module matrix - toggles which company_workspace modules are
 * shared with the linked org. Defaults match DEFAULT_COMPANY_WORKSPACE_MODULES.
 */
export function PartnerModuleMatrix({
  value,
  defaultValue,
  onChange,
  readOnly = false,
  label = 'Shared modules',
  className = '',
}: PartnerModuleMatrixProps) {
  const initial = value ?? defaultValue ?? [...DEFAULT_COMPANY_WORKSPACE_MODULES]
  const [internal, setInternal] = useState<string[]>(initial)
  const selected = value ?? internal

  const modules = useMemo(() => [...COMPANY_WORKSPACE_MODULES], [])

  function toggle(mod: string) {
    if (readOnly) return
    const next = selected.includes(mod)
      ? selected.filter((m) => m !== mod)
      : [...selected, mod]
    if (value === undefined) setInternal(next)
    onChange?.(next)
  }

  return (
    <div className={className}>
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {modules.map((mod) => {
          const on = selected.includes(mod)
          return (
            <button
              key={mod}
              type="button"
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => toggle(mod)}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                on
                  ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)]/15 text-[var(--color-pib-text)]'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'
              } disabled:cursor-default disabled:opacity-80`}
            >
              {mod}
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--color-pib-text-muted)]">
        Shared modules appear in the linked organisation’s portal as “Shared with us”. Per-record Keep private still applies.
      </p>
    </div>
  )
}
