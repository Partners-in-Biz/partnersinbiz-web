'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialHistoryWorkspace from '@/components/social/SocialHistoryWorkspace'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalPostHistory() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const buildApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <SocialHistoryWorkspace
      title="Post History"
      description="View all your published and scheduled posts"
      limit={200}
      buildApiPath={buildApiPath}
      statusOptions={['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled']}
      showPlatformFilter
    />
  )
}
