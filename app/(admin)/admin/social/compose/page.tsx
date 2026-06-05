'use client'

import { useOrg } from '@/lib/contexts/OrgContext'
import SocialPostComposer from '@/components/social/SocialPostComposer'

export const dynamic = 'force-dynamic'

export default function ComposePage() {
  const { orgId } = useOrg()

  return (
    <SocialPostComposer
      orgId={orgId}
      accountsHref="/admin/social/accounts"
      afterSaveHref="/admin/social/queue"
      afterPublishHref="/admin/social/history"
      previewFallbackName="Your Name"
      previewFallbackHandle="@yourhandle"
      advanced
      queryPrefill
      accountFilter="connected"
      previewMode="toggle"
    />
  )
}
