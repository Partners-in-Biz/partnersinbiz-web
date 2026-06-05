'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialAccountsManager from '@/components/social/SocialAccountsManager'
import { useOrg } from '@/lib/contexts/OrgContext'

export default function AccountsPage() {
  const { orgId, orgName } = useOrg()
  const searchParams = useSearchParams()

  const basePath = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('picker')
    params.delete('platform')
    params.delete('status')
    params.delete('message')
    const query = params.toString()
    return query ? `/admin/social/accounts?${query}` : '/admin/social/accounts'
  }, [searchParams])

  if (!orgId) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 p-6">
        <header>
          <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-accent)]">Admin social</p>
          <h1 className="mt-1 font-headline text-3xl font-bold tracking-tight text-on-surface">Social accounts</h1>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
            Select a client context before connecting or troubleshooting social accounts.
          </p>
        </header>
        <div className="pib-card p-8 text-center">
          <p className="text-sm text-on-surface-variant">Select a client context before connecting social accounts.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <SocialAccountsManager
        orgId={orgId}
        basePath={basePath}
        eyebrow="Admin social"
        title="Social accounts"
        description={`Connect and manage social profiles for ${orgName || 'the selected client'}. Multiple accounts per platform are supported.`}
        emptyDescription="Connect the first account for this client so scheduled content has somewhere to publish."
      />
    </div>
  )
}
