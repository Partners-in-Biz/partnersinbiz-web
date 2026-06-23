import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { SpeedAnalyzerClient } from './SpeedAnalyzerClient'

export const dynamic = 'force-dynamic'

export default async function SpeedAnalyzerPage({
  searchParams,
}: {
  searchParams?: Promise<PortalSeoSearchParams>
}) {
  const params = await searchParams
  const ctx = await resolveSeoToolContext(params)
  if (!ctx.ok) {
    if (ctx.reason === 'unauthenticated') redirect('/login')
    if (ctx.reason === 'forbidden') notFound()
    return <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">No organisation linked.</div>
  }

  // Load recent performance runs for this org (last 30)
  let historicalRuns: any[] = []
  if (ctx.orgId) {
    try {
      const runsSnap = await adminDb
        .collection('seo_performance_runs')
        .where('orgId', '==', ctx.orgId)
        .where('deleted', '==', false)
        .orderBy('ranAt', 'desc')
        .limit(30)
        .get()
      historicalRuns = runsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    } catch {
      // ignore — index may not exist yet
    }
  }

  return (
    <FeatureGate feature="seo">
      <SpeedAnalyzerClient
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        defaultUrl={ctx.activeSprint?.siteUrl ?? ''}
        historicalRuns={historicalRuns}
      />
    </FeatureGate>
  )
}
