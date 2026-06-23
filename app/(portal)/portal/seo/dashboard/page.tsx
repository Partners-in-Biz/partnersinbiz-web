import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { buildSeoDashboard } from '@/lib/seo/dashboard'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { SeoDashboardClient } from './SeoDashboardClient'

export const dynamic = 'force-dynamic'

export default async function SeoDashboardPage({
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

  const dashboard = await buildSeoDashboard(
    ctx.orgId,
    ctx.activeSprint?.id ?? null,
    ctx.activeSprint?.siteUrl ?? '',
  )

  return (
    <FeatureGate feature="seo">
      <SeoDashboardClient
        dashboard={dashboard}
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
      />
    </FeatureGate>
  )
}
