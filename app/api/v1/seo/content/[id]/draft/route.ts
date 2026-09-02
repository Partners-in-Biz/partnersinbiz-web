import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import { generateBlogDraft } from '@/lib/seo/tools/ai-generators'
import { logActivity } from '@/lib/activity/log'
import type { ApiUser } from '@/lib/api/types'
import { inheritSprintCompanyFields } from '@/lib/seo/tenant'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withAuth(
  'admin',
  withIdempotency(async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const ref = adminDb.collection('seo_content').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Content not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Access denied', 403)

    // Resolve the keyword string from the linked keyword doc, if any.
    let keyword = ''
    if (data.targetKeywordId) {
      const kwSnap = await adminDb.collection('seo_keywords').doc(data.targetKeywordId).get()
      if (kwSnap.exists) keyword = (kwSnap.data() as { keyword?: string } | undefined)?.keyword ?? ''
    }
    if (!keyword) keyword = (data.title as string) ?? ''

    const draft = await generateBlogDraft({
      title: data.title,
      keyword,
      targetUrl: data.targetUrl,
      type: data.type,
    })

    const draftRef = await adminDb.collection('seo_drafts').add({
      contentId: id,
      sprintId: data.sprintId,
      orgId: data.orgId,
      title: draft.title,
      type: data.type,
      body: draft.body,
      metaDescription: draft.metaDescription,
      wordCount: draft.wordCount,
      generatedBy: draft.generatedBy,
      generatedAt: FieldValue.serverTimestamp(),
      status: 'draft',
      ...inheritSprintCompanyFields(data),
      createdAt: FieldValue.serverTimestamp(),
    })

    await ref.update({
      status: 'review',
      draftPostId: draftRef.id,
      ...lastActorFrom(user),
    })
    logActivity({
      orgId: data.orgId,
      type: 'seo_content_drafted',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Saved SEO content as draft',
      entityId: id,
      entityType: 'seo_content',
    }).catch(() => {})

    return apiSuccess({
      id,
      draftPostId: draftRef.id,
      wordCount: draft.wordCount,
      generatedBy: draft.generatedBy,
    })
  }),
)
