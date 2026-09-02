import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { inheritSprintCompanyFields } from '@/lib/seo/tenant'

export async function generateAuditSnapshot(sprintId: string, snapshotDay: number): Promise<string> {
  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) throw new Error('Sprint not found')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = sprintSnap.data() as any

  const keywordsSnap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()
  let impressions = 0
  let clicks = 0
  let top100 = 0
  let top10 = 0
  let top3 = 0
  let positionSum = 0
  let positionN = 0
  for (const k of keywordsSnap.docs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = k.data() as any
    impressions += d.currentImpressions ?? 0
    clicks += d.currentClicks ?? 0
    if (d.currentPosition) {
      positionSum += d.currentPosition
      positionN++
    }
    if (d.currentPosition && d.currentPosition <= 100) top100++
    if (d.currentPosition && d.currentPosition <= 10) top10++
    if (d.currentPosition && d.currentPosition <= 3) top3++
  }

  const blSnap = await adminDb
    .collection('seo_backlinks')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()
  const totalBacklinks = blSnap.size
  const referringDomains = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blSnap.docs.map((d) => (d.data() as any).domain).filter(Boolean),
  ).size

  const contentSnap = await adminDb
    .collection('seo_content')
    .where('sprintId', '==', sprintId)
    .where('status', '==', 'live')
    .get()
  const postsPublished = contentSnap.size
  const comparisonPagesLive = contentSnap.docs.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (d.data() as any).type === 'comparison',
  ).length

  const ref = await adminDb.collection('seo_audits').add({
    sprintId,
    orgId: sprint.orgId,
    snapshotDay,
    capturedAt: new Date().toISOString(),
    traffic: {
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      avgPosition: positionN > 0 ? positionSum / positionN : 0,
    },
    rankings: { top100, top10, top3 },
    authority: { referringDomains, totalBacklinks },
    content: { pagesIndexed: postsPublished, postsPublished, comparisonPagesLive },
    source: 'mixed',
    deleted: false,
    ...inheritSprintCompanyFields(sprint),
    createdAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}
