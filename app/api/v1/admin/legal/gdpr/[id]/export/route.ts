/**
 * GET /api/v1/admin/legal/gdpr/[id]/export   (super-admin)
 *   ?format=json  — download the bundle with Content-Disposition
 *
 * Cross-org data-subject ACCESS export. Gathers what the platform knows about
 * the DSR's subjectEmail from CONFIRMED-EXISTING collections only:
 *   - users            (by `email`)
 *   - legal_acceptances (by `userEmail`)
 *   - support_tickets   (by `requesterEmail`)
 *   - the gdpr_requests doc itself
 *
 * Best-effort: collections that don't exist simply return empty arrays. We do
 * not invent collections.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'gdpr_requests'
type RouteContext = { params: Promise<{ id: string }> }

async function safeQuery(
  collection: string,
  field: string,
  value: string,
): Promise<Record<string, unknown>[]> {
  try {
    const snap = await adminDb.collection(collection).where(field, '==', value).limit(500).get()
    return snap.docs.map((d) => serializeGovernance({ id: d.id, ...d.data() }))
  } catch {
    return []
  }
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  try {
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
    const { id } = await ctx.params
    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('DSR not found', 404)
    const request = serializeGovernance({ id: snap.id, ...snap.data() })
    const subjectEmail = String(request.subjectEmail || '').toLowerCase()
    if (!subjectEmail) return apiError('DSR has no subjectEmail', 400)

    const [users, legalAcceptances, supportTickets] = await Promise.all([
      safeQuery('users', 'email', subjectEmail),
      safeQuery('legal_acceptances', 'userEmail', subjectEmail),
      safeQuery('support_tickets', 'requesterEmail', subjectEmail),
    ])

    const bundle = {
      generatedAt: new Date().toISOString(),
      generatedBy: { uid: user.uid, role: user.role },
      subjectEmail,
      dsr: request,
      note:
        'Best-effort cross-platform export. Queried collections confirmed to exist: ' +
        'users, legal_acceptances, support_tickets. Additional product data living in ' +
        'tenant-scoped collections is not included in this access export.',
      data: {
        users,
        legalAcceptances,
        supportTickets,
      },
      counts: {
        users: users.length,
        legalAcceptances: legalAcceptances.length,
        supportTickets: supportTickets.length,
      },
    }

    const format = new URL(req.url).searchParams.get('format')?.toLowerCase()
    if (format === 'json') {
      return new Response(JSON.stringify(bundle, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="dsr-export-${id}-${Date.now()}.json"`,
        },
      })
    }

    return apiSuccess({ bundle })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
