import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/seo/reports/[id]/share — enable a public share link (+ expiry).
 * Body: { enabled: boolean, expiresInDays?: number }
 *
 * Returns the public PDF URL (token-scoped) when enabled, or null when disabled.
 */
export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const enabled = body?.enabled !== false

    const ref = adminDb.collection('seo_reports').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Report not found', 404)
    const data = snap.data() as { orgId?: string; shareToken?: string }
    if (user.role !== 'ai' && data.orgId !== user.orgId) return apiError('Forbidden', 403)

    if (!enabled) {
      await ref.update({ shareToken: null, shareExpiresAt: null })
      return apiSuccess({ enabled: false, url: null, token: null, expiresAt: null })
    }

    const token = data.shareToken || randomBytes(20).toString('base64url')
    const days = typeof body?.expiresInDays === 'number' && body.expiresInDays > 0 ? Math.min(body.expiresInDays, 365) : 30
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    await ref.update({ shareToken: token, shareExpiresAt: expiresAt })

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
    return apiSuccess({
      enabled: true,
      token,
      url: `${base}/api/v1/seo/reports/share/${token}`,
      expiresAt,
    })
  },
)
