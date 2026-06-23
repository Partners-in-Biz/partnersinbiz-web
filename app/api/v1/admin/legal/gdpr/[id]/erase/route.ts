/**
 * POST /api/v1/admin/legal/gdpr/[id]/erase   (super-admin)
 *   body: { confirm: true }
 *
 * Right-to-erasure for the DSR's subjectEmail:
 *   - scrub PII from matching `users` docs (email/name -> '[erased]', add erasedAt)
 *     ONLY for users whose role !== 'admin' (never erase admin accounts)
 *   - mark the gdpr request 'completed'
 *   - append an immutable audit log entry (never deleted — 3yr retention)
 * Returns counts of what was erased.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'gdpr_requests'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  try {
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('DSR not found', 404)

    const body = await req.json().catch(() => ({}))
    if ((body as Record<string, unknown>)?.confirm !== true) {
      return apiError('Erasure requires { confirm: true }', 400)
    }

    const dsr = snap.data() as Record<string, unknown>
    const subjectEmail = String(dsr.subjectEmail || '').toLowerCase()
    if (!subjectEmail) return apiError('DSR has no subjectEmail', 400)

    // Find matching user docs by email.
    const userSnap = await adminDb.collection('users').where('email', '==', subjectEmail).limit(500).get()

    let erasedUsers = 0
    let skippedAdmins = 0
    const erasedAt = new Date().toISOString()
    const batch = adminDb.batch()

    for (const d of userSnap.docs) {
      const role = String(d.data().role || '')
      if (role === 'admin') {
        skippedAdmins += 1
        continue
      }
      batch.update(d.ref, {
        email: '[erased]',
        name: '[erased]',
        displayName: '[erased]',
        erasedAt: FieldValue.serverTimestamp(),
        erasedByDsr: id,
      })
      erasedUsers += 1
    }

    // Mark DSR completed + append immutable audit log.
    const logEntry = {
      at: erasedAt,
      actor: actorOf(user),
      action: 'erasure',
      detail: `Erased PII for ${subjectEmail}: ${erasedUsers} user doc(s) scrubbed, ${skippedAdmins} admin doc(s) preserved`,
    }
    batch.update(ref, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      handledBy: actorOf(user),
      erasedAt: FieldValue.serverTimestamp(),
      log: FieldValue.arrayUnion(logEntry),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await batch.commit()

    const saved = await ref.get()
    return apiSuccess({
      erased: {
        users: erasedUsers,
        skippedAdmins,
        subjectEmail,
      },
      request: serializeGovernance({ id, ...saved.data() }),
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
