// app/api/v1/admin/analytics/scrolledbrain/route.ts
//
// Scrolledbrain analytics admin view (US-313).
//
//   GET  -> ?period=7d|30d|90d  metrics with period-compare, error log, env-sync.
//   POST -> { action: 'rotate-ingest-key', propertyId } — env-sync control.

import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { writeAdminAudit } from '@/lib/admin/audit'
import { loadScrolledbrain, normalisePeriod, rotateScrolledbrainIngestKey } from './data'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  try {
    const url = new URL(req.url)
    const period = normalisePeriod(url.searchParams.get('period'))
    return apiSuccess(await loadScrolledbrain(user, period))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  let body: { action?: unknown; propertyId?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : ''

  if (action !== 'rotate-ingest-key') return apiError("action must be 'rotate-ingest-key'", 400)
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const result = await rotateScrolledbrainIngestKey(user, propertyId)
    if (!result.ok) {
      if (result.reason === 'not_found') return apiError('Property not found', 404)
      return apiError('You do not have access to this property', 403)
    }

    await writeAdminAudit(user, {
      action: 'scrolledbrain.rotate_ingest_key',
      summary: `Rotated Scrolledbrain ingest key for property ${propertyId}`,
      metadata: { propertyId },
    })

    return apiSuccess({ propertyId, ingestKey: result.ingestKey, rotated: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
