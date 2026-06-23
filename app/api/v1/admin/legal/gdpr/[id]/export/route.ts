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

async function safeQueryMany(
  collection: string,
  clauses: Array<{ field: string; value: string }>,
): Promise<Record<string, unknown>[]> {
  const rows = new Map<string, Record<string, unknown>>()
  await Promise.all(
    clauses.map(async ({ field, value }) => {
      if (!value) return
      const result = await safeQuery(collection, field, value)
      for (const row of result) {
        const id = typeof row.id === 'string' ? row.id : JSON.stringify(row)
        rows.set(id, row)
      }
    }),
  )
  return Array.from(rows.values())
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

    const [users, supportTickets] = await Promise.all([
      safeQuery('users', 'email', subjectEmail),
      safeQuery('support_tickets', 'requesterEmail', subjectEmail),
    ])
    const userIds = users
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((value): value is string => Boolean(value))

    const [contacts, emails, legalAcceptanceRows, notifications] = await Promise.all([
      safeQuery('contacts', 'email', subjectEmail),
      safeQuery('emails', 'to', subjectEmail),
      safeQueryMany('legal_acceptances', [
        { field: 'userEmail', value: subjectEmail },
        ...userIds.map((userId) => ({ field: 'userId', value: userId })),
      ]),
      safeQueryMany('notifications', userIds.map((userId) => ({ field: 'userId', value: userId }))),
    ])

    const bundle = {
      generatedAt: new Date().toISOString(),
      generatedBy: { uid: user.uid, role: user.role },
      subjectEmail,
      dsr: request,
      note:
        'Best-effort cross-platform export. Queried collections confirmed to exist: ' +
        'users, contacts, emails, legal_acceptances, notifications, support_tickets. ' +
        'Additional tenant-scoped product data may still require manual review.',
      data: {
        users,
        contacts,
        emails,
        legalAcceptances: legalAcceptanceRows,
        notifications,
        supportTickets,
      },
      counts: {
        users: users.length,
        contacts: contacts.length,
        emails: emails.length,
        legalAcceptances: legalAcceptanceRows.length,
        notifications: notifications.length,
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
