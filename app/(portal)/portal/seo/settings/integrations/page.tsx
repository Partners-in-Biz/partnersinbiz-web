import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { resolveSeoToolContext } from '../../seoToolContext'
import type { PortalSeoSearchParams } from '../../portalSeoScope'
import { IntegrationsClient } from './IntegrationsClient'

export const dynamic = 'force-dynamic'

export default async function SeoIntegrationsPage({
  searchParams,
}: {
  searchParams?: Promise<PortalSeoSearchParams & { gsc?: string; sprintId?: string }>
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

  return (
    <FeatureGate feature="seo">
      <IntegrationsClient
        sprints={ctx.sprints.map((s) => ({
          id: s.id,
          siteName: s.siteName,
          siteUrl: s.siteUrl,
          gscConnected: s.gscConnected,
          gscPropertyUrl: s.gscPropertyUrl,
        }))}
        justConnectedSprintId={params?.gsc === 'connected' ? params?.sprintId : undefined}
      />
    </FeatureGate>
  )
}
