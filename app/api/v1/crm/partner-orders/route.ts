import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import {
  listPartnerOrders,
  placePartnerOrder,
  type PartnerOrderDirection,
  type PartnerOrderStatus,
} from '@/lib/partner-links/trade'

export const dynamic = 'force-dynamic'

/**
 * GET  ?direction=purchase|sales&status=pending|confirmed|rejected
 * POST { relationshipId, lines: [{ catalogItemId, qty }], notes? }
 */
export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const direction = cleanString(req.nextUrl.searchParams.get('direction'))
    const status = cleanString(req.nextUrl.searchParams.get('status'))
    const orders = await listPartnerOrders({
      orgId: ctx.orgId,
      direction: (direction === 'purchase' || direction === 'sales')
        ? direction as PartnerOrderDirection
        : undefined,
      status: status ? status as PartnerOrderStatus : undefined,
    })
    return apiSuccess({ orders })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const relationshipId = cleanString(body.relationshipId)
    if (!relationshipId) return apiError('relationshipId is required', 400)

    const rawLines = Array.isArray(body.lines) ? body.lines : []
    if (rawLines.length === 0) return apiError('lines is required and must not be empty', 400)

    const lines = rawLines.map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>
      return { catalogItemId: cleanString(row.catalogItemId), qty: Number(row.qty) }
    })
    if (lines.some((l) => !l.catalogItemId)) return apiError('every line needs a catalogItemId', 400)
    if (lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
      return apiError('every line needs a qty greater than zero', 400)
    }
    // One line per catalogue item: duplicates collapse the same product onto
    // one shippedQuantities key and would double-reserve stock on confirm.
    const seen = new Set<string>()
    for (const l of lines) {
      if (seen.has(l.catalogItemId)) {
        return apiError('each catalogue item may only appear once per order', 400)
      }
      seen.add(l.catalogItemId)
    }

    const idempotencyKey = cleanString(req.headers.get('Idempotency-Key'))
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return apiError('Idempotency-Key header is required and must be at most 200 characters', 400)
    }

    const result = await placePartnerOrder({
      buyerOrgId: ctx.orgId,
      relationshipId,
      lines,
      notes: cleanString(body.notes) || undefined,
      idempotencyKey,
      actor: ctx.actor,
    })
    return apiSuccess(result, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
