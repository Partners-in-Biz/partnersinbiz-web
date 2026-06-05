import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listContactDocuments, type ContactLinkSubject } from '@/lib/companies/command-center'

type RouteCtx = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export const GET = withCrmAuth<RouteCtx>(
  'viewer',
  async (req, ctx, routeCtx) => {
    const { id } = await routeCtx!.params
    const snap = await adminDb.collection('contacts').doc(id).get()
    if (!snap.exists) return apiError('Contact not found', 404)

    const contact = { id: snap.id, ...snap.data() } as ContactLinkSubject
    if (contact.orgId !== ctx.orgId) return apiError('Contact not found', 404)

    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '50') || 50, 1), 200)
    const documents = await listContactDocuments(contact, { limit })
    return apiSuccess({ documents })
  },
)
