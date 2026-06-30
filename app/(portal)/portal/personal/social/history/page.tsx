'use client'
export const dynamic = 'force-dynamic'

import { useCallback } from 'react'
import SocialHistoryWorkspace from '@/components/social/SocialHistoryWorkspace'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

export default function PersonalPostHistory() {
  const buildApiPath = useCallback((path: string) => appendQueryParams(path, { scope: 'personal' }), [])

  return (
    <SocialHistoryWorkspace
      title="Personal post history"
      description="View drafts, scheduled posts, published posts, and failed sends for your user-owned social accounts."
      limit={200}
      buildApiPath={buildApiPath}
      statusOptions={['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled']}
      showPlatformFilter
      emptyMessage="No personal posts yet. Compose your first personal post to start building your vault and history."
    />
  )
}
