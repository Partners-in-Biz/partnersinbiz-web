import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { summariseAccountData } from '@/lib/account/purge'
import { sendEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

const RECOVERY_WINDOW_DAYS = 30

/**
 * POST /api/v1/account/delete
 * Initiates a hardened, recoverable account deletion. Multi-step confirmation
 * is enforced client-side (AccountDeletionFlow). Server records a scheduled
 * job in `account_deletions` with a 30-day recovery window. A future cron
 * processor purges via lib/account/purge.purgeAccount once purgeAfter passes.
 */
export const POST = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    const existing = await adminDb
      .collection('account_deletions')
      .where('uid', '==', uid)
      .where('status', '==', 'scheduled')
      .limit(1)
      .get()

    const dataSummary = await summariseAccountData(uid)
    const now = Date.now()
    const purgeAfter = now + RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000

    if (!existing.empty) {
      const doc = existing.docs[0]
      return apiSuccess({
        job: { id: doc.id, ...doc.data(), status: 'scheduled' },
        dataSummary,
        recoveryWindowDays: RECOVERY_WINDOW_DAYS,
        alreadyScheduled: true,
      })
    }

    const ref = adminDb.collection('account_deletions').doc()
    const job = {
      uid,
      status: 'scheduled' as const,
      requestedAt: FieldValue.serverTimestamp(),
      purgeAfter,
      dataSummary,
    }
    await ref.set(job)

    // Confirmation email — best effort.
    let userEmail = ''
    try {
      const userSnap = await adminDb.collection('users').doc(uid).get()
      userEmail = String(userSnap.data()?.email ?? '')
    } catch {
      /* ignore */
    }
    if (userEmail) {
      const recoverBy = new Date(purgeAfter).toUTCString()
      await sendEmail({
        to: userEmail,
        subject: 'Your Partners in Biz account is scheduled for deletion',
        html: `
          <p>We received a request to delete your Partners in Biz account.</p>
          <p>Your account and data are scheduled for permanent deletion. You can
          still recover it any time before <strong>${recoverBy}</strong>
          (${RECOVERY_WINDOW_DAYS}-day recovery window) by signing in and cancelling
          the deletion from Account settings.</p>
          <p>If you did not request this, sign in immediately and cancel the deletion.</p>
        `,
      }).catch(() => {})
    }

    return apiSuccess(
      {
        job: { id: ref.id, uid, status: 'scheduled', purgeAfter, dataSummary },
        dataSummary,
        recoveryWindowDays: RECOVERY_WINDOW_DAYS,
        alreadyScheduled: false,
      },
      201,
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})
