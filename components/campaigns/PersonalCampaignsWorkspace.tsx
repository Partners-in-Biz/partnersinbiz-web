'use client'

import { Icon } from '@/components/studio'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { appendQueryParams } from '@/lib/portal/scoped-routing'
import { useResolvedPortalOrgId } from '@/components/portal/useResolvedPortalOrgId'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'

type PersonalCampaign = {
  id: string
  name?: string
  status?: string
  createdAt?: string
  clientType?: string
}

export function PersonalCampaignsWorkspace() {
  const { orgId, resolving } = useResolvedPortalOrgId()
  const [campaigns, setCampaigns] = useState<PersonalCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const apiPath = useCallback((path: string) => appendQueryParams(path, {
    scope: 'personal',
    orgId,
  }), [orgId])

  const loadCampaigns = useCallback(async () => {
    if (resolving || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiPath('/api/v1/campaigns'))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
      setCampaigns(Array.isArray(body.data) ? body.data : [])
    } catch (err) {
      setCampaigns([])
      setError(err instanceof Error ? err.message : 'Failed to load personal campaigns.')
    } finally {
      setLoading(false)
    }
  }, [apiPath, orgId, resolving])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(apiPath('/api/v1/campaigns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          clientType: 'service-business',
          accountScope: 'personal',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
      setName('')
      const id = body.data?.id
      if (typeof id === 'string' && id) {
        window.location.assign(`/portal/personal/campaigns/${id}`)
        return
      }
      await loadCampaigns()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create personal campaign.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6" data-module-accent="rose">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="sc-tiny">Personal workspace</p>
          <h1 className="pib-page-title mt-1.5">Personal campaigns</h1>
          <p className="pib-page-sub max-w-2xl">
            Create and run campaigns against your own social accounts. Organisation pages and company campaigns stay in the company workspace.
          </p>
        </div>
        <Link href="/portal/personal/social/accounts" className="btn-pib-secondary btn-pib-sm self-start md:self-auto">
          Personal accounts
        </Link>
      </header>

      <form onSubmit={handleCreate} className="pib-card space-y-3">
        <div>
          <h2 className="font-headline text-lg text-[var(--color-pib-text)]">New personal campaign</h2>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Posts in this campaign can only publish to accounts connected in Personal marketing.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Campaign name"
            aria-label="Personal campaign name"
            className="pib-input flex-1"
            disabled={creating || resolving || !orgId}
          />
          <button
            type="submit"
            disabled={creating || resolving || !orgId || !name.trim()}
            className="btn-pib-accent justify-center disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? 'Creating...' : 'Create campaign'}
          </button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>

      <section className="space-y-3">
        <h2 className="pib-label">Your campaigns</h2>
        {loading || resolving ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, index) => (
              <div key={index} className="pib-skeleton h-28 rounded-md" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="pib-card py-14 text-center">
            <span aria-hidden="true" className="mx-auto">
              <Icon name="flag" />
            </span>
            <h3 className="mt-3 font-headline text-xl text-[var(--color-pib-text)]">No personal campaigns yet</h3>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              Create one above. It will only ever send to your personal social accounts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((campaign) => (
              <CampaignProgramCard
                key={campaign.id}
                campaign={campaign}
                href={`/portal/personal/campaigns/${campaign.id}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
