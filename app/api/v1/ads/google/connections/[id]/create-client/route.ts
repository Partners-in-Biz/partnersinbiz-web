// app/api/v1/ads/google/connections/[id]/create-client/route.ts
//
// Create a NEW Google Ads client account (subaccount) under the manager (MCC)
// that the connection authenticates. Use this when the client's account does
// not exist yet — unlike the `/customers` picker, which only lists accounts
// that already exist. After creation the new customer id can be selected via
// `PATCH /api/v1/ads/google/connections/[id]/customer`.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { createCustomerClient } from '@/lib/ads/providers/google/customer-clients'
import type { AdConnection } from '@/lib/ads/types'

const COLLECTION = 'ad_connections'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
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

    let body: {
      descriptiveName?: unknown
      currencyCode?: unknown
      timeZone?: unknown
      managerCustomerId?: unknown
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return apiError('Invalid JSON body', 400)
    }

    const descriptiveName =
      typeof body.descriptiveName === 'string' ? body.descriptiveName.trim() : ''
    if (!descriptiveName) return apiError('descriptiveName is required', 400)

    // Sensible South-African defaults for AHS Law; overridable per request.
    const currencyCode =
      typeof body.currencyCode === 'string' && body.currencyCode.trim()
        ? body.currencyCode.trim().toUpperCase()
        : 'ZAR'
    const timeZone =
      typeof body.timeZone === 'string' && body.timeZone.trim()
        ? body.timeZone.trim()
        : 'Africa/Johannesburg'

    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('Connection not found', 404)
    const conn = snap.data() as AdConnection
    // Cross-tenant + platform guard — same 404 as the sibling Google routes so
    // we don't leak whether a connectionId exists in another org.
    if (conn.orgId !== orgId || conn.platform !== 'google') {
      return apiError('Connection not found', 404)
    }

    // Resolve the manager (MCC) that will own the new client: explicit override,
    // then the connection's stored loginCustomerId, then the selected customer.
    const meta = (conn.meta ?? {}) as Record<string, unknown>
    const googleMeta = (meta.google as Record<string, unknown> | undefined) ?? {}
    const rawManager =
      (typeof body.managerCustomerId === 'string' && body.managerCustomerId) ||
      (typeof googleMeta.loginCustomerId === 'string' && googleMeta.loginCustomerId) ||
      (typeof conn.defaultAdAccountId === 'string' && conn.defaultAdAccountId) ||
      ''
    const managerCustomerId = String(rawManager).replace(/[-\s]/g, '')
    if (!/^\d{8,12}$/.test(managerCustomerId)) {
      return apiError(
        'No manager customer id available. Select the MCC on the connection or pass managerCustomerId.',
        400,
      )
    }

    const developerToken = readDeveloperToken()
    if (!developerToken) return apiError('Google Ads developer token not configured', 500)
    const accessToken = decryptAccessToken(conn)

    try {
      const result = await createCustomerClient({
        managerCustomerId,
        accessToken,
        developerToken,
        descriptiveName,
        currencyCode,
        timeZone,
      })
      return apiSuccess({ ...result, managerCustomerId })
    } catch (err) {
      return apiError((err as Error).message ?? 'createCustomerClient failed', 500)
    }
  },
)
