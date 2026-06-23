import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { resolvePortalSeoUser } from '../../portalSeoScope'
import type { SeoKeyword, SeoAudit } from '@/lib/seo/types'
import { KeywordHistoryClient } from './KeywordHistoryClient'

export const dynamic = 'force-dynamic'

function serializeKeyword(id: string, d: SeoKeyword): Omit<SeoKeyword, 'createdAt'> & { createdAt: string } {
  return {
    ...d,
    id,
    createdAt: d.createdAt
      ? typeof d.createdAt === 'string'
        ? d.createdAt
        : (d.createdAt as { toMillis?: () => number }).toMillis
        ? new Date((d.createdAt as { toMillis: () => number }).toMillis()).toISOString()
        : String(d.createdAt)
      : '',
  }
}

export default async function KeywordHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const kwSnap = await adminDb.collection('seo_keywords').doc(id).get()
  if (!kwSnap.exists) notFound()

  const kwData = kwSnap.data() as SeoKeyword
  const user = await resolvePortalSeoUser(kwData.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const keyword = serializeKeyword(kwSnap.id, kwData)

  // Sibling keywords for compare picker
  const siblingsSnap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', kwData.sprintId)
    .where('deleted', '==', false)
    .get()
  const siblings = siblingsSnap.docs
    .filter((d) => d.id !== id)
    .map((d) => ({ id: d.id, keyword: (d.data() as SeoKeyword).keyword }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword))

  // Sprint audits for annotations
  const auditsSnap = await adminDb
    .collection('seo_audits')
    .where('sprintId', '==', kwData.sprintId)
    .where('deleted', '==', false)
    .get()
  const audits: Pick<SeoAudit, 'id' | 'snapshotDay' | 'capturedAt'>[] = auditsSnap.docs.map((d) => {
    const a = d.data() as SeoAudit
    return { id: d.id, snapshotDay: a.snapshotDay, capturedAt: a.capturedAt }
  })

  return (
    <KeywordHistoryClient
      keyword={keyword}
      siblings={siblings}
      audits={audits}
    />
  )
}
