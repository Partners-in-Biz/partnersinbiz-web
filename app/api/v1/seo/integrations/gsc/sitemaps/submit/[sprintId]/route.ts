import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { refreshGscClient, submitSitemap } from '@/lib/seo/integrations/gsc'
import { decryptCredentials } from '@/lib/integrations/crypto'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function defaultSitemapUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/sitemap.xml`
}

function sitemapErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/insufficient authentication scopes|Request had insufficient authentication scopes/i.test(message)) {
    return 'GSC token does not include write scope. Reconnect Search Console, then retry sitemap submission.'
  }
  if (/User does not have sufficient permission|not a verified owner|permission/i.test(message)) {
    return 'Connected Google account does not have owner permission for this Search Console property.'
  }
  return message
}

export const POST = withAuth(
  'admin',
  withIdempotency(async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ sprintId: string }> }) => {
    const { sprintId } = await ctx.params
    const body = await req.json().catch(() => ({})) as { sitemapUrl?: unknown }
    const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
    if (!snap.exists) return apiError('Sprint not found', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprint = snap.data() as any
    if (!canAccessOrg(user, sprint.orgId)) return apiError('Access denied', 403)

    const gsc = sprint.integrations?.gsc
    if (!gsc?.connected || !gsc?.propertyUrl || !gsc?.tokens) {
      return apiError('GSC must be connected and have a selected property before submitting a sitemap', 400)
    }

    const sitemapUrl = typeof body.sitemapUrl === 'string' && body.sitemapUrl.trim()
      ? body.sitemapUrl.trim()
      : defaultSitemapUrl(sprint.siteUrl)

    let refreshToken: string | undefined
    try {
      refreshToken = decryptCredentials<{ refresh_token?: string }>(gsc.tokens, sprint.orgId).refresh_token
    } catch {
      return apiError('GSC credentials could not be decrypted. Reconnect Search Console, then retry.', 400)
    }
    if (!refreshToken) return apiError('GSC tokens missing refresh_token. Reconnect Search Console, then retry.', 400)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = refreshGscClient(refreshToken) as any
      await submitSitemap(auth, gsc.propertyUrl, sitemapUrl)
    } catch (err) {
      return apiError(sitemapErrorMessage(err), 400)
    }

    return apiSuccess({ sprintId, propertyUrl: gsc.propertyUrl, sitemapUrl, submitted: true })
  }),
)
