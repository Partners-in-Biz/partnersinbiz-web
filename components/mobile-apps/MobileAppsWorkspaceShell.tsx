'use client'

import type { ReactNode } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'

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
      <main className={['mx-auto max-w-6xl space-y-4', className].filter(Boolean).join(' ')}>
        <div className="pib-skeleton h-96" />
      </main>
    )
  }

  return (
    <main className={['mx-auto max-w-6xl space-y-4', className].filter(Boolean).join(' ')} data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow={eyebrow}
        title={title}
        description={description}
        meta={(
          <div className="grid w-full max-w-md grid-cols-3 gap-2 sm:max-w-lg">
            <StatCard accent="cyan" icon="smartphone" label="Apps" value={apps.length} />
            <StatCard accent="cyan" icon="rocket_launch" label="Live" value={liveApps} />
            <StatCard accent="cyan" icon="visibility" label={visibleLabel} value={visibleAppCount(apps)} />
          </div>
        )}
      />

      {notice ? (
        <Surface className="p-3 text-sm text-[var(--color-pib-text)]">{notice}</Surface>
      ) : null}

      {children}
    </main>
  )
}
