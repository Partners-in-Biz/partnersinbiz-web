'use client'

import SocialOverviewWorkspace from '@/components/social/SocialOverviewWorkspace'

export const dynamic = 'force-dynamic'

export default function SocialOverviewPage() {
  return (
    <SocialOverviewWorkspace
      surface="admin"
      title="Social Overview"
      description="Monitor and manage your social media presence"
      postsLimit={200}
      showInboxCount
      showRecentPosts
      quickActions={[
        { label: 'Compose Post', href: '/admin/social/compose', icon: 'edit', primary: true },
        { key: 'inbox', label: 'Inbox', href: '/admin/social/inbox', icon: 'inbox' },
        { label: 'View Queue', href: '/admin/social/queue', icon: 'pending_actions' },
        { label: 'Calendar', href: '/admin/social/calendar', icon: 'calendar_month' },
        { label: 'Design', href: '/admin/social/design', icon: 'design_services' },
        { label: 'Accounts', href: '/admin/social/accounts', icon: 'link' },
        { label: 'Analytics', href: '/admin/social/analytics', icon: 'analytics' },
        { label: 'Links', href: '/admin/social/links', icon: 'add_link' },
      ]}
    />
  )
}
