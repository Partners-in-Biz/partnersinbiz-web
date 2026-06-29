// app/api/v1/account/2fa/status/route.ts
import { NextRequest } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    if (process.env.DISABLE_ADMIN_2FA === 'true') {
      return apiSuccess({ enabled: false, backupCodesRemaining: 0, disabledByPolicy: true })
    }
    const userDoc = await adminDb.collection('users').doc(uid).get()
    const twoFactor = userDoc.data()?.twoFactor
    const enabled = twoFactor?.enabled === true
    const backupCodesRemaining = Array.isArray(twoFactor?.backupCodes)
      ? twoFactor.backupCodes.length
      : 0
    return apiSuccess({ enabled, backupCodesRemaining })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
