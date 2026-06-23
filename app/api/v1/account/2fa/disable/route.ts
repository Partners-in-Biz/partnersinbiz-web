// app/api/v1/account/2fa/disable/route.ts
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
      return apiError('2FA is not enabled', 400)
    }

    let authorized = false
    if (token && verifyToken(twoFactor.secret, token)) {
      authorized = true
    } else if (backupCode) {
      const hashed = hashBackupCode(backupCode)
      const codes: string[] = Array.isArray(twoFactor.backupCodes) ? twoFactor.backupCodes : []
      authorized = codes.includes(hashed)
    }

    if (!authorized) return apiError('Invalid verification or backup code', 400)

    await userRef.set({ twoFactor: FieldValue.delete() }, { merge: true })

    return apiSuccess({ enabled: false })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
