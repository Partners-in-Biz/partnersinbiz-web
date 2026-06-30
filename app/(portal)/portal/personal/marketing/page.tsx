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
          { label: 'Company social', href: '/portal/social', icon: 'business' },
        ]}
      />

      <section className="grid gap-4 md:grid-cols-2" aria-label="Personal versus company social distinction">
        <div className="pib-card space-y-2">
          <p className="eyebrow !text-[10px]">Personal account scope</p>
          <h2 className="font-display text-xl text-[var(--color-pib-text)]">User-owned channels</h2>
          <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">Posts, vault items, calendar entries, and connected accounts here belong to your login and personal voice. This is where Peet can work with his own X bookmarks and personal social channels.</p>
        </div>
        <div className="pib-card space-y-2">
          <p className="eyebrow !text-[10px]">Company / organisation scope</p>
          <h2 className="font-display text-xl text-[var(--color-pib-text)]">Shared brand channels</h2>
          <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">Organisation social remains for client or company publishing, team approvals, shared brand accounts, content-engine campaigns, and managed delivery work.</p>
        </div>
      </section>

      <PersonalXMcpConnectionCard setupSurface="portal_personal_marketing" />
    </div>
  )
}
