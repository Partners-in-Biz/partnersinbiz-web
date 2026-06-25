// app/api/v1/account/2fa/challenge/route.ts
// Login-time TOTP challenge. Verifies a code (or backup code) for the current
// authenticated session so the portal/admin control plane can mark 2FA
// satisfied for this session.
//
// US-277 hardening:
//  - On success we mint a signed, HttpOnly verification cookie that the admin
//    SERVER layout checks (the old sessionStorage flag was client-only and
//    bypassable).
//  - A failed-attempt lockout (5 fails / 30 min) throttles brute-force of the
//    6-digit TOTP / backup codes.
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { verifyTokenWithCounter, hashBackupCode } from '@/lib/auth/totp'
import {
  ADMIN_2FA_COOKIE,
  admin2faCookieOptions,
  clearFailedAttempts,
  consumeTotpCounter,
  getLockoutState,
  issueAdmin2faToken,
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
      // 2FA not enabled => nothing to satisfy; treat as success.
      return apiSuccess({ verified: true })
    }

    let verified = false
    if (token) {
      const match = verifyTokenWithCounter(twoFactor.secret, token)
      // Reject replay of an already-consumed TOTP step before accepting.
      if (match && (await consumeTotpCounter(uid, match.counter))) {
        verified = true
      }
    } else if (backupCode) {
      const hashed = hashBackupCode(backupCode)
      const codes: string[] = Array.isArray(twoFactor.backupCodes) ? twoFactor.backupCodes : []
      if (codes.includes(hashed)) {
        verified = true
        // Consume the single-use backup code.
        await userRef.set(
          { twoFactor: { backupCodes: codes.filter((c) => c !== hashed) } },
          { merge: true },
        )
      }
    }

    if (!verified) {
      const state = await recordFailedAttempt(uid)
      await userRef
        .collection('loginHistory')
        .add({ event: '2fa_challenge_failed', at: FieldValue.serverTimestamp() })
        .catch(() => {})
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

    // Success — clear failures and mint the server-checked verification cookie.
    await clearFailedAttempts(uid)
    await userRef
      .collection('loginHistory')
      .add({ event: '2fa_challenge_passed', at: FieldValue.serverTimestamp() })
      .catch(() => {})

    const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
    const sessionCookieValue = req.cookies.get(sessionCookieName)?.value ?? ''

    const response = apiSuccess({ verified: true })
    if (sessionCookieValue) {
      response.cookies.set(
        ADMIN_2FA_COOKIE,
        issueAdmin2faToken(uid, sessionCookieValue),
        admin2faCookieOptions(),
      )
    }
    return response
  } catch (err) {
    return apiErrorFromException(err)
  }
})
