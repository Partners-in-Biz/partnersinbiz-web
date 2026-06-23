// app/api/v1/account/2fa/setup/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { generateSecret, otpauthUrl } from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

const ISSUER = 'Partners in Biz'

export const POST = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    const secret = generateSecret()

    let label = uid
    try {
      const userRecord = await adminAuth.getUser(uid)
      if (userRecord.email) label = userRecord.email
    } catch {
      // fall back to uid as label
    }

    await adminDb
      .collection('users')
      .doc(uid)
      .set(
        {
          twoFactor: {
            secret,
            enabled: false,
            pendingSince: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      )

    return apiSuccess({ secret, otpauthUrl: otpauthUrl(secret, label, ISSUER) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
