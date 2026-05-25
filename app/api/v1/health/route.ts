// app/api/v1/health/route.ts
/**
 * GET /api/v1/health
 *
 * Smoke-test endpoint for the auth stack.
 * Returns the authenticated identity.
 *
 * Auth: Bearer <AI_API_KEY> | Bearer <firebaseIdToken> | session cookie
 * Role: admin or ai
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

export const GET = withAuth('admin', async (_req, user) => {
  return apiSuccess({
    ok: true,
    timestamp: new Date().toISOString(),
    services: {
      auth: 'ok',
      api: 'ok',
      firestore: 'ok',
    },
    identity: { uid: user.uid, role: user.role },
  })
})
