'use client'

import { useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import { AdminBookStudioGovernanceWorkspace } from './AdminBookStudioGovernanceWorkspace'
import { BookStudioProjectsIndex } from './BookStudioProjectsIndex'

type BookStudioAdminIndexTabsProps = {
  orgId: string
  orgSlug: string
}

export function BookStudioAdminIndexTabs({ orgId, orgSlug }: BookStudioAdminIndexTabsProps) {
  const [tab, setTab] = useState<'projects' | 'governance'>('projects')

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PageTabs
        value={tab}
        onValueChange={(value) => setTab(value as 'projects' | 'governance')}
        tabs={[
          { label: 'Projects', value: 'projects', icon: 'auto_stories' },
          { label: 'Governance', value: 'governance', icon: 'shield' },
        ]}
      />
      {tab === 'projects' ? (
        <BookStudioProjectsIndex orgId={orgId} orgSlug={orgSlug} />
      ) : (
        <AdminBookStudioGovernanceWorkspace orgSlug={orgSlug} />
      )}
    </div>
  )
}
