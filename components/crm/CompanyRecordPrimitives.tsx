'use client'

import type { ReactNode } from 'react'
import { Icon } from '@/components/studio'

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
    <span className="pib-pill pib-pill-success">
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
    <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
      <Icon name={icon} className="text-[22px] text-[var(--color-pib-text-muted)]" />
      <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      {children ? <div className="mt-3 flex justify-center">{children}</div> : null}
    </div>
  )
}

export function CompanyRecordTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}
