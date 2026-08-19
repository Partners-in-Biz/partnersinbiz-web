'use client'

import { useCallback } from 'react'
import SocialOverviewWorkspace from '@/components/social/SocialOverviewWorkspace'
import { PersonalXMcpConnectionCard } from '@/components/workspace-os/PersonalXMcpConnectionCard'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

function personalApiPath(path: string) {
  return appendQueryParams(path, { scope: 'personal' })
}

export default function PersonalMarketingPage() {
  const buildApiPath = useCallback((path: string) => personalApiPath(path), [])

  return (
    <div className="space-y-8">
      <SocialOverviewWorkspace
        surface="portal"
        title="Personal marketing"
        eyebrow="Personal workspace"
        description="Your own social accounts, drafts, scheduled posts, content vault, and X intelligence. This is user-owned and stays separate from company or organisation marketing."
        postsLimit={200}
        buildApiPath={buildApiPath}
        showConnectedAccounts
        showApprovalTabs={false}
        showRecentPosts
        primaryAction={{ label: 'Compose personal post', href: '/portal/personal/social/compose', icon: 'edit_square' }}
        quickActions={[
          { label: 'Content vault', href: '/portal/personal/social/vault', icon: 'folder' },
          { label: 'Post history', href: '/portal/personal/social/history', icon: 'history' },
          { label: 'Calendar', href: '/portal/personal/social/calendar', icon: 'calendar_month' },
          { label: 'Accounts', href: '/portal/personal/social/accounts', icon: 'add_link' },
          { label: 'Campaigns', href: '/portal/personal/campaigns', icon: 'flag' },
        ]}
      />

      <section className="pib-card space-y-2" aria-label="Personal marketing scope">
        <p className="eyebrow !text-[10px]">Personal account scope</p>
        <h2 className="font-display text-xl text-[var(--color-pib-text)]">User-owned channels</h2>
        <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">Posts, vault items, calendar entries, campaigns, and connected accounts here belong to your login. Organisation pages and company campaigns stay in the company workspace and cannot be selected from this screen.</p>
      </section>

      <PersonalXMcpConnectionCard setupSurface="portal_personal_marketing" />
    </div>
  )
}
