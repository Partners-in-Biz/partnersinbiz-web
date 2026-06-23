// app/api/v1/account/sessions/[id]/route.ts
import { NextRequest } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { revokeSessionRecord } from '@/lib/auth/session-registry'

export const dynamic = 'force-dynamic'

export const DELETE = withPortalAuth(
  async (_req: NextRequest, uid: string, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params
      if (!id) return apiError('Session id is required', 400)

      const ref = adminDb.collection('users').doc(uid).collection('sessions').doc(id)
      const doc = await ref.get()
      if (!doc.exists) return apiError('Session not found', 404)

      await revokeSessionRecord(uid, id)
      return apiSuccess({ revoked: true, id })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
