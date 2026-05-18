/**
 * POST /api/v1/crm/contacts/:id/recompute-score — manually recompute scores
 * for a single contact (admin+).
 *
 * Body: { includeAi?: boolean }   defaults to true
 *
 * Returns the ScoreUpdate on success, 404 if contact not found / cross-tenant.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeScoresForContact } from '@/lib/scoring/compute'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteContext>(
  'admin',
  async (req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params

    // Verify contact exists and belongs to this org
    const contactRef = adminDb.collection('contacts').doc(id)
    const contactSnap = await contactRef.get()
    if (!contactSnap.exists) return apiError('Contact not found', 404)
    const contactData = contactSnap.data()!
    if (contactData.orgId !== ctx.orgId) return apiError('Contact not found', 404)

    // Parse optional body
    let includeAi = true
    const bodyText = await req.text()
    if (bodyText && bodyText.trim() !== '') {
      try {
        const parsed = JSON.parse(bodyText)
        if (typeof parsed?.includeAi === 'boolean') {
          includeAi = parsed.includeAi
        }
      } catch {
        return apiError('Invalid JSON', 400)
      }
    }

    // Compute scores
    const update = await computeScoresForContact(ctx.orgId, id, {
      includeAi,
      actor: ctx.actor,
    })

    if (update === null) {
      return apiError('Contact not found or cross-tenant', 404)
    }

    return apiSuccess({ update })
  },
)
