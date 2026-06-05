'use client'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialOverviewWorkspace from '@/components/social/SocialOverviewWorkspace'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalSocialDashboard() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const buildApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const buildHref = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  return (
    <SocialOverviewWorkspace
      surface="portal"
      title="Social"
      eyebrow="Social media"
      description="Approve content, monitor your queue, and keep every platform in sync."
      postsLimit={200}
      buildApiPath={buildApiPath}
      buildHref={buildHref}
      loadOrgName
      showConnectedAccounts
      showApprovalTabs
      showRecentPosts
      primaryAction={{ label: 'Compose post', href: '/portal/social/compose', icon: 'edit' }}
      quickActions={[
        { label: 'Vault', href: '/portal/social/vault', icon: 'folder' },
        { label: 'Post history', href: '/portal/social/history', icon: 'history' },
        { label: 'Calendar', href: '/portal/social/calendar', icon: 'calendar_month' },
        { label: 'Accounts', href: '/portal/social/accounts', icon: 'link' },
        { label: 'Links', href: '/portal/social/links', icon: 'add_link' },
      ]}
    />
  )
}
