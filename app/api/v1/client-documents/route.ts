import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { CLIENT_DOCUMENTS_COLLECTION, createClientDocument } from '@/lib/client-documents/store'
import { themeFromOrg } from '@/lib/client-documents/themeFromOrg'
import type {
  ClientDocumentLinkSet,
  ClientDocumentStatus,
  ClientDocumentType,
  DocumentAssumption,
  DocumentTheme,
} from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import type { Organization } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

const VALID_TYPES: ClientDocumentType[] = [
  'sales_proposal',
  'build_spec',
  'social_strategy',
  'content_campaign_plan',
  'geo_seo_strategy',
  'research_report',
  'monthly_report',
  'launch_signoff',
  'change_request',
]

const VALID_STATUSES: ClientDocumentStatus[] = [
  'internal_draft',
  'internal_review',
  'client_review',
  'changes_requested',
  'approved',
  'accepted',
  'archived',
]
const LINKED_STRING_FIELDS = new Set(['projectId', 'campaignId', 'reportId', 'dealId', 'seoSprintId', 'geoWorkspaceId', 'geoAuditId', 'invoiceId'])
const LINKED_FIELDS = new Set([...LINKED_STRING_FIELDS, 'socialPostIds', 'geoTaskIds', 'researchItemIds'])
const ASSUMPTION_CREATE_FIELDS = new Set(['text', 'severity', 'blockId'])
const ASSUMPTION_SEVERITIES = new Set(['info', 'needs_review', 'blocks_publish'])

type CreateAssumptionInput = {
  text: string
  severity?: DocumentAssumption['severity']
  blockId?: string
}

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function validateCreateLinked(
  value: unknown,
): { ok: true; value: ClientDocumentLinkSet } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'linked must be an object' }
  }

  const linked = value as Record<string, unknown>
  const unknownFields = Object.keys(linked).filter((field) => !LINKED_FIELDS.has(field))
  if (unknownFields.length > 0) {
    return { ok: false, error: `linked contains unsupported field(s): ${unknownFields.join(', ')}` }
  }

  for (const field of LINKED_STRING_FIELDS) {
    if (field in linked && typeof linked[field] !== 'string') {
      return { ok: false, error: `linked.${field} must be a string` }
    }
  }

  if (
    'socialPostIds' in linked &&
    (!Array.isArray(linked.socialPostIds) || linked.socialPostIds.some((postId) => typeof postId !== 'string'))
  ) {
    return { ok: false, error: 'linked.socialPostIds must be an array of strings' }
  }

  if (
    'geoTaskIds' in linked &&
    (!Array.isArray(linked.geoTaskIds) || linked.geoTaskIds.some((taskId) => typeof taskId !== 'string'))
  ) {
    return { ok: false, error: 'linked.geoTaskIds must be an array of strings' }
  }

  if (
    'researchItemIds' in linked &&
    (!Array.isArray(linked.researchItemIds) || linked.researchItemIds.some((researchId) => typeof researchId !== 'string'))
  ) {
    return { ok: false, error: 'linked.researchItemIds must be an array of strings' }
  }

  return { ok: true, value: linked as ClientDocumentLinkSet }
}

function validateCreateAssumptions(
  value: unknown,
): { ok: true; value: CreateAssumptionInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'assumptions must be an array' }

  const assumptions: CreateAssumptionInput[] = []
  for (const [index, assumption] of value.entries()) {
    if (!assumption || typeof assumption !== 'object' || Array.isArray(assumption)) {
      return { ok: false, error: `assumptions[${index}] must be an object` }
    }

    const row = assumption as Record<string, unknown>
    const unknownFields = Object.keys(row).filter((field) => !ASSUMPTION_CREATE_FIELDS.has(field))
    if (unknownFields.length > 0) {
      return { ok: false, error: `assumptions[${index}] contains unsupported field(s): ${unknownFields.join(', ')}` }
    }

    const text = typeof row.text === 'string' ? row.text.trim() : ''
    if (!text) return { ok: false, error: `assumptions[${index}].text must be a non-empty string` }

    if (
      row.severity !== undefined &&
      (typeof row.severity !== 'string' || !ASSUMPTION_SEVERITIES.has(row.severity))
    ) {
      return { ok: false, error: `assumptions[${index}].severity must be one of: info, needs_review, blocks_publish` }
    }

    if (row.blockId !== undefined && typeof row.blockId !== 'string') {
      return { ok: false, error: `assumptions[${index}].blockId must be a string` }
    }

    assumptions.push({
      text,
      ...(row.severity === undefined ? {} : { severity: row.severity as DocumentAssumption['severity'] }),
      ...(row.blockId === undefined ? {} : { blockId: row.blockId }),
    })
  }

  return { ok: true, value: assumptions }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const status = searchParams.get('status')
  if (status && !VALID_STATUSES.includes(status as ClientDocumentStatus)) {
    return apiError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400)
  }

  const type = searchParams.get('type')
  if (type && !VALID_TYPES.includes(type as ClientDocumentType)) {
    return apiError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).where('orgId', '==', scope.orgId)
  if (status) query = query.where('status', '==', status)
  if (type) query = query.where('type', '==', type)

  const snap = await query.get()
  const documents = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((doc: any) => doc.deleted !== true)

  return apiSuccess(documents)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  if (!VALID_TYPES.includes(body.type)) {
    return apiError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400)
  }

  let orgId: string | undefined
  if (body.orgId !== undefined) {
    const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
    const scope = resolveOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    orgId = scope.orgId
  } else if (user.role === 'client') {
    return apiError('orgId is required for client users', 400)
  }

  let linked: ClientDocumentLinkSet = {}
  if ('linked' in body) {
    const linkedResult = validateCreateLinked(body.linked)
    if (!linkedResult.ok) return apiError(linkedResult.error, 400)
    linked = linkedResult.value
  }

  let assumptions: CreateAssumptionInput[] = []
  if ('assumptions' in body) {
    const assumptionsResult = validateCreateAssumptions(body.assumptions)
    if (!assumptionsResult.ok) return apiError(assumptionsResult.error, 400)
    assumptions = assumptionsResult.value
  }

  // Auto-populate the first version's theme from the org's brand colors. If
  // the request body supplied its own theme, that wins. If there is no orgId
  // (internal-only drafts) or the org has no brand colors yet, the store falls
  // back to the PiB default theme.
  let autoTheme: DocumentTheme | null = null
  if (orgId) {
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    if (orgSnap?.exists) {
      const orgData = { id: orgSnap.id, ...orgSnap.data() } as Organization
      autoTheme = themeFromOrg(orgData)
    }
  }
  const bodyTheme = (body as { theme?: DocumentTheme }).theme
  const versionTheme: DocumentTheme | undefined = bodyTheme ?? autoTheme ?? undefined

  const created = await createClientDocument({
    title,
    type: body.type,
    orgId,
    linked,
    assumptions,
    user,
    theme: versionTheme,
  })

  return apiSuccess({ ...created, orgId, status: 'internal_draft', actorType: actorType(user) }, 201)
})
