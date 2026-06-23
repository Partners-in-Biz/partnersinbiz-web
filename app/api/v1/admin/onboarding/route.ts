/**
 * GET  /api/v1/admin/onboarding — list onboarding submissions for the admin queue.
 * POST /api/v1/admin/onboarding — create a submission (manual entry / testing).
 *
 * Reads/writes the existing `onboarding_submissions` collection. Also returns
 * the list of platform admins (users where role == 'admin') so the UI can offer
 * an assign-admin dropdown without a second round-trip.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
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
} from './_shared'

export const dynamic = 'force-dynamic'

async function listAdmins(): Promise<Array<{ uid: string; email: string; displayName: string }>> {
  const snap = await adminDb.collection('users').where('role', '==', 'admin').get()
  return snap.docs
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>
      return {
        uid: doc.id,
        email: typeof d.email === 'string' ? d.email : '',
        displayName: typeof d.displayName === 'string' && d.displayName ? d.displayName : (typeof d.email === 'string' ? d.email : doc.id),
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export const GET = withAuth('admin', async (_req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const [snap, admins] = await Promise.all([
    adminDb.collection(ONBOARDING_COLLECTION).get(),
    listAdmins().catch(() => []),
  ])

  const submissions = snap.docs
    .map((doc) => toOnboardingView(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return apiSuccess({ submissions, admins })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const body = await req.json().catch(() => ({}))
  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : ''
  const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : ''
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : ''
  if (!businessName) return apiError('businessName is required', 400)
  if (!contactEmail) return apiError('contactEmail is required', 400)

  const status: OnboardingStatus = ONBOARDING_STATUSES.includes(body.status)
    ? body.status
    : 'new'
  const progress = Number.isFinite(Number(body.progress))
    ? Math.min(100, Math.max(0, Math.round(Number(body.progress))))
    : 0

  const ref = await adminDb.collection(ONBOARDING_COLLECTION).add({
    businessName,
    contactName,
    contactEmail,
    orgId: typeof body.orgId === 'string' ? body.orgId : null,
    progress,
    status,
    assignedAdminUid: typeof body.assignedAdminUid === 'string' ? body.assignedAdminUid : null,
    internalNotes: [],
    source: 'admin-manual',
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAdminAudit(user, {
    action: 'onboarding.create',
    summary: `Created onboarding submission for "${businessName}"`,
    metadata: { submissionId: ref.id, contactEmail },
  })

  const created = await ref.get()
  return apiSuccess(toOnboardingView(ref.id, created.data() as Record<string, unknown>), 201)
})
