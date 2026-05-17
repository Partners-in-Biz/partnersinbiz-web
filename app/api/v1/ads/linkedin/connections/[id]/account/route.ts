// app/api/v1/ads/linkedin/connections/[id]/account/route.ts
//
// Sets the `selectedAdAccountUrn` on a LinkedIn Ads connection. Called by the
// admin connections UI after the user picks an ad account from the
// `GET /api/v1/ads/linkedin/accounts` response.
//
// LinkedIn-namespaced rather than reusing the generic `[platform]` route so
// Meta's and Google's connection mutation paths stay untouched and the LinkedIn
// flow can evolve (e.g. validation against organization hierarchy or billing
// account checks) independently.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { updateConnection } from '@/lib/ads/connections/store'
import type { AdConnection } from '@/lib/ads/types'

const COLLECTION = 'ad_connections'

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

    let body: { selectedAdAccountUrn?: unknown }
    try {
      body = (await req.json()) as { selectedAdAccountUrn?: unknown }
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const raw = body.selectedAdAccountUrn
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return apiError('selectedAdAccountUrn must be a URN of form urn:li:sponsoredAccount:{id}', 400)
    }
    // LinkedIn ad account URNs are of the form urn:li:sponsoredAccount:{numericId}
    const selectedAdAccountUrn = raw.trim()
    if (!/^urn:li:sponsoredAccount:\d+$/.test(selectedAdAccountUrn)) {
      return apiError('selectedAdAccountUrn must be a URN of form urn:li:sponsoredAccount:{id}', 400)
    }

    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('Connection not found', 404)
    const conn = snap.data() as AdConnection

    // Cross-tenant + platform guard. Same 404 as `GET .../accounts` so we
    // don't leak that a connectionId exists in another org.
    if (conn.orgId !== orgId || conn.platform !== 'linkedin') {
      return apiError('Connection not found', 404)
    }

    // Merge with any existing meta.linkedin fields so we never clobber other
    // forward-compatible flags (e.g. memberUrn, organizationUrn, refreshTokenExpiresAt).
    const existingMeta = (conn.meta ?? {}) as Record<string, unknown>
    const existingLinkedin =
      (existingMeta.linkedin as Record<string, unknown> | undefined) ?? {}

    const nextMeta = {
      ...existingMeta,
      linkedin: {
        ...existingLinkedin,
        selectedAdAccountUrn,
      },
    }

    await updateConnection(conn.id, { meta: nextMeta })

    return apiSuccess({ id: conn.id, selectedAdAccountUrn })
  },
)
