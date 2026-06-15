import { adminDb } from '@/lib/firebase/admin'
import type { CampaignAssets } from '@/lib/types/campaign'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isVideoPost(p: any): boolean {
  return Array.isArray(p.media) && p.media[0]?.type === 'video'
}

export async function buildCampaignAssets(campaignId: string): Promise<CampaignAssets> {
  const [socialSnap, seoSnap] = await Promise.all([
    adminDb.collection('social_posts').where('campaignId', '==', campaignId).get(),
    adminDb.collection('seo_content').where('campaignId', '==', campaignId).get(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSocial: any[] = socialSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const social = allSocial.filter((p) => !isVideoPost(p))
  const videos = allSocial.filter((p) => isVideoPost(p))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blogsRaw: any[] = seoSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d): any => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.deleted !== true)

  const blogs = await Promise.all(
    blogsRaw.map(async (b) => {
      if (!b.draftPostId) return { ...b, draft: null }
      const draftSnap = await adminDb.collection('seo_drafts').doc(b.draftPostId).get()
      if (!draftSnap.exists) return { ...b, draft: null }
      const dd = draftSnap.data()!
      return {
        ...b,
        draft: {
          wordCount: dd.wordCount ?? 0,
          generatedBy: dd.generatedBy ?? 'unknown',
          body: dd.body,
          metaDescription: dd.metaDescription,
        },
      }
    }),
  )

  const byStatus = { draft: 0, pending_approval: 0, approved: 0, published: 0 }
  for (const p of allSocial) {
    if (p.status === 'draft') byStatus.draft++
    else if (p.status === 'pending_approval') byStatus.pending_approval++
    else if (p.status === 'approved') byStatus.approved++
    else if (p.status === 'published') byStatus.published++
  }
  for (const b of blogs) {
    if (b.status === 'idea' || b.status === 'review') byStatus.pending_approval++
    else if (b.status === 'live') byStatus.published++
    else if (b.status === 'draft') byStatus.draft++
  }

  return {
    campaignId,
    social,
    blogs,
    videos,
    meta: {
      totals: { social: social.length, blogs: blogs.length, videos: videos.length },
      byStatus,
    },
  }
}
