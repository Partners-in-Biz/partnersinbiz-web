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
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      {children ? <div className="mt-5 flex justify-center">{children}</div> : null}
    </div>
  )
}

export function CompanyRecordTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="bento-card overflow-hidden">
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}
