'use client'

import type { ReactNode } from 'react'

export function readableCompanyStatusLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

export function CompanyRecordStatusChip({
  value,
  emptyLabel = 'Status not set',
}: {
  value?: unknown
  emptyLabel?: string
}) {
  if (typeof value !== 'string' || !value.trim()) {
    return <span className="text-xs text-[var(--color-pib-text-muted)]">{emptyLabel}</span>
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-300">
      {readableCompanyStatusLabel(value)}
    </span>
  )
}

export function CompanyRecordEmptyPanel({
  icon,
  label,
  children,
}: {
  icon: string
  label: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
      <span className="material-symbols-outlined text-[22px] text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      {children ? <div className="mt-3 flex justify-center">{children}</div> : null}
    </div>
  )
}

export function CompanyRecordTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}
