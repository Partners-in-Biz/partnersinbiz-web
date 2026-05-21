import { NextRequest } from 'next/server'
import { google } from 'googleapis'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { refreshGscClient } from '@/lib/seo/integrations/gsc'
import { decryptCredentials } from '@/lib/integrations/crypto'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ sprintId: string }> }) => {
    const { sprintId } = await ctx.params
    const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.data() as any
    if (!canAccessOrg(user, data.orgId)) return apiError('Access denied', 403)
    const tokens = data.integrations?.gsc?.tokens
    if (!tokens) return apiError('GSC not connected', 400)
    const decrypted = decryptCredentials<{ refresh_token?: string }>(tokens, data.orgId)
    if (!decrypted.refresh_token) return apiError('GSC tokens missing refresh_token', 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = refreshGscClient(decrypted.refresh_token) as any
    const wm = google.webmasters({ version: 'v3', auth })
    let sites
    try {
      sites = await wm.sites.list()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/Search Console API has not been used|searchconsole\.googleapis\.com|disabled/i.test(message)) {
        return apiError(
          'Google Search Console API is disabled for the connected Google Cloud project. Enable searchconsole.googleapis.com, then retry property selection.',
          424,
          { code: 'GSC_API_DISABLED' },
        )
      }
      throw err
    }
    const properties = (sites.data.siteEntry ?? []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }))
    return apiSuccess(properties)
  },
)
