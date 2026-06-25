// app/api/v1/account/2fa/verify/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { verifyTokenWithCounter, generateBackupCodes, hashBackupCode } from '@/lib/auth/totp'
import {
  clearFailedAttempts,
  consumeTotpCounter,
  getLockoutState,
  recordFailedAttempt,
} from '@/lib/auth/admin-2fa'

export const dynamic = 'force-dynamic'

function lockoutMessage(lockedUntil: number | null): string {
  if (!lockedUntil) return 'Too many failed attempts. Try again later.'
  const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000))
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) return apiError('Verification code is required', 400)

    // Refuse early if the account is currently locked out.
    const lockout = await getLockoutState(uid)
    if (lockout.locked) {
      return apiError(lockoutMessage(lockout.lockedUntil), 429, {
        lockedUntil: lockout.lockedUntil,
        remainingAttempts: 0,
      })
    }

    const userRef = adminDb.collection('users').doc(uid)
    const userDoc = await userRef.get()
    const twoFactor = userDoc.data()?.twoFactor
    if (!twoFactor?.secret) return apiError('No pending 2FA setup found', 400)
    if (twoFactor.enabled) return apiError('2FA is already enabled', 400)

    // Verify the code and reject replay of an already-consumed TOTP step.
    const match = verifyTokenWithCounter(twoFactor.secret, token)
    if (!match || !(await consumeTotpCounter(uid, match.counter))) {
      const state = await recordFailedAttempt(uid)
      if (state.locked) {
        return apiError(lockoutMessage(state.lockedUntil), 429, {
          lockedUntil: state.lockedUntil,
          remainingAttempts: 0,
        })
      }
      return apiError('Invalid verification code', 400, {
        remainingAttempts: state.remainingAttempts,
      })
    }

    await clearFailedAttempts(uid)

    const backupCodes = generateBackupCodes(10)
    const hashedBackupCodes = backupCodes.map(hashBackupCode)

    await userRef.set(
      {
        twoFactor: {
          secret: twoFactor.secret,
          enabled: true,
          enabledAt: FieldValue.serverTimestamp(),
          backupCodes: hashedBackupCodes,
        },
      },
      { merge: true },
    )

    // Plaintext codes returned ONCE — never stored or returned again.
    return apiSuccess({ enabled: true, backupCodes })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
