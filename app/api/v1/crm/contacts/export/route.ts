/**
 * GET /api/v1/crm/contacts/export — download contacts for the org as CSV
 *
 * Honours the same list filters as GET /api/v1/crm/contacts so the export
 * always matches what the operator sees in the list:
 *   stage, type, source, tags (csv), status (active|unsubscribed|bounced),
 *   utmSource, minScore (>=), search
 *
 * Optional `ids` (csv query param OR JSON body for large selections) restricts
 * the export to a specific selection — used by the bulk command bar's
 * "Export selected" action. When `ids` is present the list filters are ignored.
 *
 * The download filename is date-stamped: contacts-YYYY-MM-DD.csv
 *
 * Auth: viewer+
 * Returns: text/csv attachment
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError } from '@/lib/api/response'
import type { Contact, ContactStage, ContactType, ContactSource } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

const VALID_STAGES: ContactStage[] = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const VALID_TYPES: ContactType[] = ['lead', 'prospect', 'client', 'churned']
const VALID_SOURCES: ContactSource[] = ['manual', 'form', 'import', 'outreach']
const VALID_STATUSES = ['active', 'unsubscribed', 'bounced'] as const
type SubscriptionStatus = (typeof VALID_STATUSES)[number]

function deriveContactStatus(c: Contact): SubscriptionStatus {
  if (c.bouncedAt) return 'bounced'
  if (c.unsubscribedAt) return 'unsubscribed'
  return 'active'
}

function fmtTimestampValue(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const candidate = value as {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number
    }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString()
    if (typeof candidate.toMillis === 'function')
      return new Date(candidate.toMillis()).toISOString()
    if (typeof candidate.seconds === 'number')
      return new Date(candidate.seconds * 1000).toISOString()
  }
  return String(value)
}

function escapeCsvField(value: string): string {
  // Wrap in quotes if the value contains a comma, double-quote, or newline.
  // Escape any internal double-quotes by doubling them.
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((v) => toStr(v)).join('; ')
  if (typeof value === 'object') {
    // Timestamp-like → ISO; otherwise JSON for nested refs/objects.
    const ts = fmtTimestampValue(value)
    if (ts && ts !== '[object Object]') return ts
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function readIdsFromQuery(searchParams: URLSearchParams): string[] | null {
  const idsParam = searchParams.get('ids')
  if (!idsParam) return null
  const list = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length > 0 ? list : null
}

// ── Shared export handler ─────────────────────────────────────────────────────
// `bodyIds` is supplied by the POST handler for large selections that can't fit
// in a query string. When ids are present (query OR body) the list filters are
// ignored and exactly that selection is exported.
async function handleExport(
  orgId: string,
  searchParams: URLSearchParams,
  bodyIds: string[] | null,
): Promise<NextResponse> {
  const selectedIds = bodyIds ?? readIdsFromQuery(searchParams)
  const selectedIdSet = selectedIds ? new Set(selectedIds) : null

  // List filters — ignored when an explicit selection is supplied.
  const stage = searchParams.get('stage') as ContactStage | null
  const type = searchParams.get('type') as ContactType | null
  const source = searchParams.get('source') as ContactSource | null
  const status = searchParams.get('status') ?? ''
  const utmSource = (searchParams.get('utmSource') ?? '').trim()
  const search = (searchParams.get('search') ?? '').trim().toLowerCase()
  const minScoreParam = searchParams.get('minScore')
  const minScore = minScoreParam !== null ? parseInt(minScoreParam, 10) : null
  const tagList = (searchParams.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const snapshot = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .get()

  let contacts: Contact[] = snapshot.docs
    .map((doc): Contact => ({ ...(doc.data() as Contact), id: doc.id }))
    .filter((c: Contact) => c.orgId === orgId && c.deleted !== true)

  if (selectedIdSet) {
    contacts = contacts.filter((c) => selectedIdSet.has(c.id))
  } else {
    if (stage && VALID_STAGES.includes(stage)) contacts = contacts.filter((c) => c.stage === stage)
    if (type && VALID_TYPES.includes(type)) contacts = contacts.filter((c) => c.type === type)
    if (source && VALID_SOURCES.includes(source)) contacts = contacts.filter((c) => c.source === source)
    if (tagList.length > 0) {
      contacts = contacts.filter((c) => {
        const tags = Array.isArray(c.tags) ? c.tags : []
        return tagList.some((tag) => tags.includes(tag))
      })
    }
    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      contacts = contacts.filter((c) => deriveContactStatus(c) === status)
    }
    if (utmSource) contacts = contacts.filter((c) => (c.utmSource ?? '') === utmSource)
    if (minScore !== null && Number.isFinite(minScore)) {
      contacts = contacts.filter((c) => (c.leadScore ?? 0) >= minScore)
    }
    if (search) {
      contacts = contacts.filter(
        (c) =>
          c.name?.toLowerCase().includes(search) ||
          c.email?.toLowerCase().includes(search) ||
          c.company?.toLowerCase().includes(search),
      )
    }
  }

  if (contacts.length === 0) {
    return apiError('No contacts found for this selection', 404)
  }

  // Full field set — every meaningful Contact column plus derived status.
  const columns: { key: string; get: (c: Contact) => unknown }[] = [
    { key: 'id', get: (c) => c.id },
    { key: 'name', get: (c) => c.name },
    { key: 'email', get: (c) => c.email },
    { key: 'phone', get: (c) => c.phone },
    { key: 'jobTitle', get: (c) => c.jobTitle },
    { key: 'department', get: (c) => c.department },
    { key: 'company', get: (c) => c.company ?? c.companyName },
    { key: 'companyName', get: (c) => c.companyName },
    { key: 'website', get: (c) => c.website },
    { key: 'source', get: (c) => c.source },
    { key: 'type', get: (c) => c.type },
    { key: 'stage', get: (c) => c.stage },
    { key: 'status', get: (c) => deriveContactStatus(c) },
    { key: 'tags', get: (c) => c.tags },
    { key: 'notes', get: (c) => c.notes },
    { key: 'assignedTo', get: (c) => c.assignedTo },
    { key: 'owner', get: (c) => c.assignedToRef?.displayName },
    { key: 'leadScore', get: (c) => c.leadScore },
    { key: 'icpScore', get: (c) => c.icpScore },
    { key: 'aiLeadScore', get: (c) => c.aiLeadScore },
    { key: 'utmSource', get: (c) => c.utmSource },
    { key: 'utmMedium', get: (c) => c.utmMedium },
    { key: 'utmCampaign', get: (c) => c.utmCampaign },
    { key: 'utmTerm', get: (c) => c.utmTerm },
    { key: 'utmContent', get: (c) => c.utmContent },
    { key: 'subscribedAt', get: (c) => fmtTimestampValue(c.subscribedAt) },
    { key: 'unsubscribedAt', get: (c) => fmtTimestampValue(c.unsubscribedAt) },
    { key: 'bouncedAt', get: (c) => fmtTimestampValue(c.bouncedAt) },
    { key: 'lastContactedAt', get: (c) => fmtTimestampValue(c.lastContactedAt) },
    { key: 'createdAt', get: (c) => fmtTimestampValue(c.createdAt) },
    { key: 'updatedAt', get: (c) => fmtTimestampValue(c.updatedAt) },
  ]

  const rows: string[] = [columns.map((col) => col.key).join(',')]
  for (const contact of contacts) {
    rows.push(columns.map((col) => escapeCsvField(toStr(col.get(contact)))).join(','))
  }

  const csvContent = rows.join('\r\n')
  const dateStamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const filename = `contacts-${dateStamp}.csv`

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

// GET — filtered export (filters in query string) or selection export via ?ids=
export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  return handleExport(ctx.orgId, searchParams, null)
})

// POST — selection export for large id sets that exceed URL-length limits.
// Body: { ids: string[] }. Filters may still be passed in the query string and
// are honoured only when no ids are supplied.
export const POST = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  let bodyIds: string[] | null = null
  try {
    const body = (await req.json()) as { ids?: unknown }
    if (Array.isArray(body.ids)) {
      const list = body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      bodyIds = list.length > 0 ? list : null
    }
  } catch {
    // no / invalid body — fall through to query-string behaviour
  }
  return handleExport(ctx.orgId, searchParams, bodyIds)
})
