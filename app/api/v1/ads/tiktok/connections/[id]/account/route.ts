// app/api/v1/ads/tiktok/connections/[id]/account/route.ts
//
// Sets the `selectedAdvertiserId` on a TikTok Ads connection. Called by the
// admin connections UI after the user picks an advertiser from the
// `GET /api/v1/ads/tiktok/accounts` response.
//
// TikTok-namespaced rather than reusing the generic `[platform]` route so
// the LinkedIn / Meta / Google connection mutation paths stay untouched and
// the TikTok flow can evolve independently.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { updateConnection } from '@/lib/ads/connections/store'
import type { AdConnection } from '@/lib/ads/types'

const COLLECTION = 'ad_connections'

// TikTok advertiser IDs are large numeric strings (typically 18-19 digits).
// Allow 6-20 digits to be safe.
const ADVERTISER_ID_RE = /^\d{6,20}$/

export const dynamic = 'force-dynamic'

export const PATCH = withAuth(
  'admin',
  async (
    req: NextRequest,
    _user: unknown,
    ctx: { params: Promise<{ id: string }> },
  ) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctx.params
    if (!id) return apiError('Missing connection id', 400)

    let body: { selectedAdvertiserId?: unknown }
    try {
      body = (await req.json()) as { selectedAdvertiserId?: unknown }
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const raw = body.selectedAdvertiserId
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return apiError('selectedAdvertiserId must be a non-empty numeric string', 400)
    }
    const selectedAdvertiserId = raw.trim()
    if (!ADVERTISER_ID_RE.test(selectedAdvertiserId)) {
      return apiError('selectedAdvertiserId must be 6-20 numeric digits', 400)
    }

    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('Connection not found', 404)
    const conn = snap.data() as AdConnection

    // Cross-tenant + platform guard. Same 404 as GET .../accounts so we
    // don't leak that a connectionId exists in another org.
    if (conn.orgId !== orgId || conn.platform !== 'tiktok') {
      return apiError('Connection not found', 404)
    }

    // Merge with any existing meta.tiktok fields so we never clobber other
    // forward-compatible flags (e.g. advertiserIds, tokenScope, refreshTokenExpiresAt).
    const existingMeta = (conn.meta ?? {}) as Record<string, unknown>
    const existingTiktok =
      (existingMeta.tiktok as Record<string, unknown> | undefined) ?? {}

    const nextMeta = {
      ...existingMeta,
      tiktok: {
        ...existingTiktok,
        selectedAdvertiserId,
      },
    }

    await updateConnection(conn.id, { meta: nextMeta })

    return apiSuccess({ id: conn.id, selectedAdvertiserId })
  },
)
