'use client'

import type { ReactNode } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'

type MobileAppsWorkspaceShellSurface = 'admin' | 'portal'

interface MobileAppsWorkspaceShellProps {
  apps: MobileAppRecord[]
  surface: MobileAppsWorkspaceShellSurface
  eyebrow: string
  title?: string
  description: string
  notice?: string
  loading?: boolean
  className?: string
  children?: ReactNode
}

function visibleAppCount(apps: MobileAppRecord[]) {
  return apps.filter((app) => app.visibility?.showInClientPortal !== false).length
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="pib-card-section px-4 py-3 text-center">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="text-xl font-bold text-on-surface">{value}</p>
    </div>
  )
}

export function MobileAppsWorkspaceShell({
  apps,
  surface,
  eyebrow,
  title = 'Mobile Apps',
  description,
  notice = '',
  loading = false,
  className = '',
  children,
}: MobileAppsWorkspaceShellProps) {
  const liveApps = apps.filter((app) => app.status === 'live').length
  const visibleLabel = surface === 'admin' ? 'Portal' : 'Visible'

  if (loading) {
    return (
      <main className={['max-w-6xl mx-auto space-y-6', className].filter(Boolean).join(' ')}>
        <div className="pib-skeleton h-96" />
      </main>
    )
  }

  return (
    <main className={['max-w-6xl mx-auto space-y-6', className].filter(Boolean).join(' ')}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Apps" value={apps.length} />
          <StatCard label="Live" value={liveApps} />
          <StatCard label={visibleLabel} value={visibleAppCount(apps)} />
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4 text-sm text-[var(--color-pib-text)]">
          {notice}
        </div>
      ) : null}

      {children}
    </main>
  )
}
