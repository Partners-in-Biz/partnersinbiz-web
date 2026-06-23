import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { buildBacklinkProfile } from '@/lib/seo/backlink-profile'
import { BacklinksClient } from './BacklinksClient'

export const dynamic = 'force-dynamic'

export default async function BacklinksPage({
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

  const profile = ctx.activeSprint ? await buildBacklinkProfile(ctx.activeSprint.id) : null

  return (
    <FeatureGate feature="seo">
      <BacklinksClient
        profile={profile}
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
      />
    </FeatureGate>
  )
}
