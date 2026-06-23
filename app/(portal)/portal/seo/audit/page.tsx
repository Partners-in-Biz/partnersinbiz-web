import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { AuditRunnerClient } from './AuditRunnerClient'

export const dynamic = 'force-dynamic'

export default async function AuditPage({
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
        No organisation linked.
      </div>
    )
  }

  // Fetch existing audits for the active sprint
  let existingAudits: any[] = []
  if (ctx.activeSprint) {
    const snap = await adminDb
      .collection('seo_audits')
      .where('sprintId', '==', ctx.activeSprint.id)
      .where('deleted', '==', false)
      .get()
    existingAudits = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => ((b.capturedAt ?? '') > (a.capturedAt ?? '') ? 1 : -1))
  }

  return (
    <FeatureGate feature="seo">
      <AuditRunnerClient
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        activeSiteUrl={ctx.activeSprint?.siteUrl}
        existingAudits={existingAudits}
      />
    </FeatureGate>
  )
}
