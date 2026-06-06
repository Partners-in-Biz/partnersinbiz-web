'use client'

import { useCallback, useMemo } from 'react'
import SocialOverviewWorkspace, { type SocialOverviewAction } from '@/components/social/SocialOverviewWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

const PLATFORM_OWNER_ORG_ID = 'pib-platform-owner'
const PLATFORM_OWNER_NAME = 'Partners in Biz'

export default function SocialOverviewPage() {
  const { orgId, orgName } = useOrg()
  const activeOrgId = orgId || PLATFORM_OWNER_ORG_ID
  const activeOrgName = orgName || PLATFORM_OWNER_NAME

  const buildApiPath = useCallback(
    (path: string) => appendQueryParams(path, { orgId: activeOrgId }),
    [activeOrgId],
  )

  const buildHref = useCallback(
    (path: string) => appendQueryParams(path, { orgId: activeOrgId }),
    [activeOrgId],
  )

  const quickActions = useMemo<SocialOverviewAction[]>(
    () => [
      { label: 'Compose Post', href: '/admin/social/compose', icon: 'edit', primary: true },
      { key: 'inbox', label: 'Inbox', href: '/admin/social/inbox', icon: 'inbox' },
      { label: 'View Queue', href: '/admin/social/queue', icon: 'pending_actions' },
      { label: 'Calendar', href: '/admin/social/calendar', icon: 'calendar_month' },
      { label: 'Design', href: '/admin/social/design', icon: 'design_services' },
      { label: 'Accounts', href: '/admin/social/accounts', icon: 'link' },
      { label: 'Analytics', href: '/admin/social/analytics', icon: 'analytics' },
      { label: 'Links', href: '/admin/social/links', icon: 'add_link' },
    ],
    [],
  )

  return (
    <SocialOverviewWorkspace
      surface="admin"
      title="Social Overview"
      description={`Monitor and manage social media for ${activeOrgName}.`}
      postsLimit={200}
      buildApiPath={buildApiPath}
      buildHref={buildHref}
      showInboxCount
      showRecentPosts
      quickActions={quickActions}
    />
  )
}
