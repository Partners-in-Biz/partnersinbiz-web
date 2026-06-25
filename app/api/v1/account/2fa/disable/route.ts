// app/api/v1/account/2fa/disable/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { verifyTokenWithCounter, hashBackupCode } from '@/lib/auth/totp'
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
    const backupCode = typeof body.backupCode === 'string' ? body.backupCode.trim() : ''
    if (!token && !backupCode) {
      return apiError('A verification code or backup code is required', 400)
    }

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
    if (!twoFactor?.enabled || !twoFactor?.secret) {
      return apiError('2FA is not enabled', 400)
    }

    let authorized = false
    if (token) {
      const match = verifyTokenWithCounter(twoFactor.secret, token)
      // Reject replay of an already-consumed TOTP step before authorizing.
      if (match && (await consumeTotpCounter(uid, match.counter))) {
        authorized = true
      }
    } else if (backupCode) {
      const hashed = hashBackupCode(backupCode)
      const codes: string[] = Array.isArray(twoFactor.backupCodes) ? twoFactor.backupCodes : []
      authorized = codes.includes(hashed)
    }

    if (!authorized) {
      const state = await recordFailedAttempt(uid)
      if (state.locked) {
        return apiError(lockoutMessage(state.lockedUntil), 429, {
          lockedUntil: state.lockedUntil,
          remainingAttempts: 0,
        })
      }
      return apiError('Invalid verification or backup code', 400, {
        remainingAttempts: state.remainingAttempts,
      })
    }

    await clearFailedAttempts(uid)
    await userRef.set({ twoFactor: FieldValue.delete() }, { merge: true })

    return apiSuccess({ enabled: false })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
