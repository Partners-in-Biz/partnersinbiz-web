'use client'
export const dynamic = 'force-dynamic'

import { useCallback } from 'react'
import SocialHistoryWorkspace from '@/components/social/SocialHistoryWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

export default function HistoryPage() {
  const { orgId } = useOrg()
  const buildApiPath = useCallback((path: string) => appendQueryParams(path, { orgId }), [orgId])

  return (
    <SocialHistoryWorkspace
      title="History"
      description="Published, failed, and cancelled posts"
      limit={200}
      buildApiPath={buildApiPath}
      statusOptions={['all', 'published', 'failed', 'cancelled']}
      visibleStatuses={['published', 'failed', 'cancelled']}
      showPlatformFilter
    />
  )
}
