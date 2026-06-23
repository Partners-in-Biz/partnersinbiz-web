import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { listCompetitors } from '@/lib/seo/competitors'
import { CompetitorsClient } from './CompetitorsClient'

export const dynamic = 'force-dynamic'

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams?: Promise<PortalSeoSearchParams>
}) {
  const params = await searchParams
  const ctx = await resolveSeoToolContext(params)
  if (!ctx.ok) {
    if (ctx.reason === 'unauthenticated') redirect('/login')
    if (ctx.reason === 'forbidden') notFound()
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const competitors = ctx.activeSprint ? await listCompetitors(ctx.activeSprint.id) : []

  return (
    <FeatureGate feature="seo">
      <CompetitorsClient
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        clientSiteUrl={ctx.activeSprint?.siteUrl ?? ''}
        initialCompetitors={competitors}
      />
    </FeatureGate>
  )
}
