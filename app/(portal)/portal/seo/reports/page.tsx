import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { adminDb } from '@/lib/firebase/admin'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { ReportsClient, type ReportRow } from './ReportsClient'

export const dynamic = 'force-dynamic'

export default async function ReportsPage({
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

  let history: ReportRow[] = []
  if (ctx.activeSprint) {
    const snap = await adminDb
      .collection('seo_reports')
      .where('sprintId', '==', ctx.activeSprint.id)
      .where('deleted', '==', false)
      .get()
    history = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>
        return {
          id: d.id,
          clientName: String(data.clientName ?? ''),
          from: String(data.from ?? ''),
          to: String(data.to ?? ''),
          createdAt: String(data.createdAtIso ?? ''),
          shareToken: (data.shareToken as string) ?? null,
          shareExpiresAt: (data.shareExpiresAt as string) ?? null,
          sections: (data.sections as ReportRow['sections']) ?? { traffic: true, rankings: true, backlinks: true },
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return (
    <FeatureGate feature="seo">
      <ReportsClient
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        defaultClientName={ctx.activeSprint?.siteName ?? ''}
        history={history}
      />
    </FeatureGate>
  )
}
