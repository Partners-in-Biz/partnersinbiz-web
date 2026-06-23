import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { adminDb } from '@/lib/firebase/admin'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { KeywordTrackerClient } from './KeywordTrackerClient'
import type { SeoKeyword } from '@/lib/seo/types'

export const dynamic = 'force-dynamic'

export default async function KeywordTrackerPage({
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

  let keywords: (Omit<SeoKeyword, 'createdAt'> & { createdAt: string })[] = []
  if (ctx.activeSprint) {
    const snap = await adminDb
      .collection('seo_keywords')
      .where('sprintId', '==', ctx.activeSprint.id)
      .where('deleted', '==', false)
      .get()
    keywords = snap.docs.map((doc) => {
      const d = doc.data() as SeoKeyword
      return {
        ...d,
        id: doc.id,
        createdAt: d.createdAt
          ? typeof d.createdAt === 'string'
            ? d.createdAt
            : (d.createdAt as { toMillis?: () => number }).toMillis
            ? new Date((d.createdAt as { toMillis: () => number }).toMillis()).toISOString()
            : String(d.createdAt)
          : '',
      }
    })
    keywords.sort((a, b) => (a.currentPosition ?? 9999) - (b.currentPosition ?? 9999))
  }

  return (
    <FeatureGate feature="seo">
      <KeywordTrackerClient
        keywords={keywords}
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        activeSprint={
          ctx.activeSprint
            ? {
                id: ctx.activeSprint.id,
                gscConnected: ctx.activeSprint.gscConnected,
              }
            : null
        }
      />
    </FeatureGate>
  )
}
