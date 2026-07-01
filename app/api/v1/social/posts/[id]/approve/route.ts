/**
 * POST /api/v1/social/posts/:id/approve — approve or reject a post pending approval
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logAudit } from '@/lib/social/audit'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function contentPreview(content: unknown, max = 60): string {
  const text = typeof content === 'string'
    ? content
    : content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string'
      ? (content as { text: string }).text
      : ''
  return `${text.slice(0, max)}${text.length > max ? '...' : ''}`
}

export const POST = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => ({}))
  const action = body.action // 'approve' | 'reject'

  if (!['approve', 'reject'].includes(action)) {
    return apiError('action must be "approve" or "reject"', 400)
  }

  const ref = adminDb.collection('social_posts').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Post not found', 404)

  const existing = doc.data()!
  if (existing.orgId && existing.orgId !== orgId) return apiError('Post not found', 404)

  // Determine new status based on action
  const newStatus = action === 'approve' ? 'approved' : 'draft'
  const updateData: Record<string, any> = {
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // When approving, record who approved and when
  if (action === 'approve') {
    updateData.approvedBy = user.uid
    updateData.approvedAt = FieldValue.serverTimestamp()
  } else {
    // When rejecting, clear approval fields
    updateData.approvedBy = null
    updateData.approvedAt = null
  }

  await ref.update(updateData)

  // Log the audit action
  await logAudit({
    orgId,
    action: action === 'approve' ? 'post.approved' : 'post.rejected',
    entityType: 'post',
    entityId: id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    ip: req.headers.get('x-forwarded-for'),
  })

  // Log activity event (fire and forget)
  const actorName = user.uid === 'ai-agent'
    ? 'AI Agent'
    : (await adminDb.collection('users').doc(user.uid).get()).data()?.displayName ?? user.uid

  const content = contentPreview(existing.content)
  logActivity({
    orgId,
    type: action === 'approve' ? 'post_approved' : 'post_rejected',
    actorId: user.uid,
    actorName,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `${action === 'approve' ? 'Approved' : 'Rejected'} post: "${content}"`,
    entityId: id,
    entityType: 'post',
    entityTitle: content,
  }).catch(() => {})

  return apiSuccess({ id, status: newStatus })
}))
