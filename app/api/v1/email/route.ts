/**
 * GET /api/v1/email — list emails
 *
 * Query params:
 *   direction  — "outbound" | "inbound"
 *   status     — "draft" | "scheduled" | "sent" | "failed" | "opened" | "clicked"
 *   contactId  — filter by linked contact
 *   limit      — default 50, max 200
 *   page       — default 1
 *
 * Auth: admin or ai
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Email, EmailDirection, EmailStatus } from '@/lib/email/types'

const VALID_DIRECTIONS: EmailDirection[] = ['outbound', 'inbound']
const VALID_STATUSES: EmailStatus[] = ['draft', 'scheduled', 'sent', 'failed', 'opened', 'clicked']

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate._seconds === 'number') return candidate._seconds * 1000
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

async function resolveOrgIdFromContact(contactId: string): Promise<string | null> {
  if (!contactId.trim()) return null
  const snap = await adminDb.collection('contacts').doc(contactId.trim()).get()
  if (!snap.exists) return null
  const orgId = snap.data()?.orgId
  return typeof orgId === 'string' && orgId.trim() ? orgId.trim() : null
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get('contactId') ?? ''
  const requestedOrgId = searchParams.get('orgId') ?? await resolveOrgIdFromContact(contactId)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const direction = searchParams.get('direction') as EmailDirection | null
  const status = searchParams.get('status') as EmailStatus | null
  const campaignId = searchParams.get('campaignId') ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // Keep the Firestore query index-safe; secondary filters and sorting happen in memory.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('emails')

  if (orgId) {
    query = query.where('orgId', '==', orgId)
  }

  const snapshot = await query.get()
  type EmailDoc = { id: string; data: () => Record<string, unknown> }
  const emailDocs = snapshot.docs as EmailDoc[]

  // Filter soft-deleted docs and optional facets in memory to avoid composite indexes.
  let emails: Email[] = emailDocs
    .map((doc: EmailDoc) => ({ id: doc.id, ...doc.data() } as Email))
    .filter((e: Email & { deleted?: boolean; campaignId?: string }) => {
      if (e.deleted === true) return false
      if (orgId && e.orgId !== orgId) return false
      if (direction && VALID_DIRECTIONS.includes(direction) && e.direction !== direction) return false
      if (status && VALID_STATUSES.includes(status) && e.status !== status) return false
      if (contactId && e.contactId !== contactId) return false
      if (campaignId && e.campaignId !== campaignId) return false
      return true
    })
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))

  // Apply pagination after in-memory filter
  const total = emails.length
  emails = emails.slice((page - 1) * limit, page * limit)

  return apiSuccess(emails, 200, { total, page, limit })
})
