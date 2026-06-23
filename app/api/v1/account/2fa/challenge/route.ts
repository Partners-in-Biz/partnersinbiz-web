// app/api/v1/account/2fa/challenge/route.ts
// Login-time TOTP challenge. Verifies a code (or backup code) for the current
// authenticated session so the portal can mark 2FA satisfied for this session.
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { verifyToken, hashBackupCode } from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const backupCode = typeof body.backupCode === 'string' ? body.backupCode.trim() : ''
    if (!token && !backupCode) {
      return apiError('A verification code or backup code is required', 400)
    }

    const userRef = adminDb.collection('users').doc(uid)
    const userDoc = await userRef.get()
    const twoFactor = userDoc.data()?.twoFactor
    if (!twoFactor?.enabled || !twoFactor?.secret) {
      // 2FA not enabled => nothing to satisfy; treat as success.
      return apiSuccess({ verified: true })
    }

    let verified = false
    if (token && verifyToken(twoFactor.secret, token)) {
      verified = true
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

    if (!verified) return apiError('Invalid verification or backup code', 400)

    await userRef
      .collection('loginHistory')
      .add({ event: '2fa_challenge_passed', at: FieldValue.serverTimestamp() })

    return apiSuccess({ verified: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
