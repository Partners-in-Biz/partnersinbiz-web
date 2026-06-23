// app/api/v1/account/2fa/verify/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { verifyToken, generateBackupCodes, hashBackupCode } from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) return apiError('Verification code is required', 400)

    const userRef = adminDb.collection('users').doc(uid)
    const userDoc = await userRef.get()
    const twoFactor = userDoc.data()?.twoFactor
    if (!twoFactor?.secret) return apiError('No pending 2FA setup found', 400)
    if (twoFactor.enabled) return apiError('2FA is already enabled', 400)

    if (!verifyToken(twoFactor.secret, token)) {
      return apiError('Invalid verification code', 400)
    }

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
