import { notFound, redirect } from 'next/navigation'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { adminDb } from '@/lib/firebase/admin'
import { resolveSeoToolContext } from '../seoToolContext'
import type { PortalSeoSearchParams } from '../portalSeoScope'
import { BriefsClient, type SavedBrief } from './BriefsClient'

export const dynamic = 'force-dynamic'

export default async function BriefsPage({
  searchParams,
}: {
  searchParams?: Promise<PortalSeoSearchParams & { keyword?: string; competitor?: string }>
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

  let saved: SavedBrief[] = []
  if (ctx.activeSprint) {
    const snap = await adminDb
      .collection('seo_briefs')
      .where('sprintId', '==', ctx.activeSprint.id)
      .where('deleted', '==', false)
      .get()
    saved = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>
        return {
          id: d.id,
          keyword: String(data.keyword ?? ''),
          title: String(data.title ?? ''),
          savedAt: String(data.savedAt ?? ''),
          brief: data.brief as SavedBrief['brief'],
        }
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  return (
    <FeatureGate feature="seo">
      <BriefsClient
        sprints={ctx.sprints.map((s) => ({ id: s.id, siteName: s.siteName, siteUrl: s.siteUrl }))}
        activeSprintId={ctx.activeSprint?.id}
        clientName={ctx.activeSprint?.siteName}
        savedBriefs={saved}
        prefillKeyword={typeof params?.keyword === 'string' ? params.keyword : ''}
        prefillCompetitor={typeof params?.competitor === 'string' ? params.competitor : ''}
      />
    </FeatureGate>
  )
}
