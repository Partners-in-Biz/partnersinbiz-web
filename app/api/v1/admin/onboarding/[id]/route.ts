/**
 * GET   /api/v1/admin/onboarding/[id] — fetch one submission (admin view).
 * PATCH /api/v1/admin/onboarding/[id] — update status / progress / assignee,
 *                                       and/or append an internal note.
 *
 * Auth: super-admin only. All mutations are audited.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import {
  ONBOARDING_COLLECTION,
  ONBOARDING_STATUSES,
  toOnboardingView,
  type OnboardingStatus,
} from '../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params
  const snap = await adminDb.collection(ONBOARDING_COLLECTION).doc(id).get()
  if (!snap.exists) return apiError('Submission not found', 404)
  return apiSuccess(toOnboardingView(id, snap.data() as Record<string, unknown>))
})

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params

  const ref = adminDb.collection(ONBOARDING_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Submission not found', 404)
  const current = snap.data() as Record<string, unknown>

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  const changes: string[] = []

  if (body.status !== undefined) {
    if (!ONBOARDING_STATUSES.includes(body.status)) {
      return apiError('Invalid status. Use: ' + ONBOARDING_STATUSES.join(', '), 400)
    }
    update.status = body.status as OnboardingStatus
    changes.push(`status→${body.status}`)
  }

  if (body.progress !== undefined) {
    const n = Number(body.progress)
    if (!Number.isFinite(n)) return apiError('progress must be a number', 400)
    update.progress = Math.min(100, Math.max(0, Math.round(n)))
    changes.push(`progress→${update.progress}%`)
  }

  if (body.assignedAdminUid !== undefined) {
    const uid = body.assignedAdminUid
    if (uid !== null && typeof uid !== 'string') return apiError('assignedAdminUid must be a string or null', 400)
    update.assignedAdminUid = uid || null
    changes.push(uid ? `assigned→${uid}` : 'unassigned')
  }

  let appendedNote = false
  if (typeof body.note === 'string' && body.note.trim()) {
    // ApiUser has no email; resolve the actor's email from their user doc for display.
    let authorEmail = ''
    try {
      const u = await adminDb.collection('users').doc(user.uid).get()
      const e = u.data()?.email
      if (typeof e === 'string') authorEmail = e
    } catch { /* best-effort */ }
    const note = {
      id: randomBytes(8).toString('hex'),
      authorUid: user.uid,
      authorEmail,
      body: body.note.trim(),
      createdAt: new Date().toISOString(),
    }
    update.internalNotes = FieldValue.arrayUnion(note)
    appendedNote = true
    changes.push('note added')
  }

  if (changes.length === 0) return apiError('No changes supplied', 400)

  await ref.set(update, { merge: true })

  await writeAdminAudit(user, {
    action: 'onboarding.update',
    orgId: typeof current.orgId === 'string' ? current.orgId : null,
    summary: `Updated onboarding "${current.businessName ?? current.clubName ?? id}": ${changes.join(', ')}`,
    metadata: { submissionId: id, changes, appendedNote },
  })

  const fresh = await ref.get()
  return apiSuccess(toOnboardingView(id, fresh.data() as Record<string, unknown>))
})

export { PATCH as PUT }
