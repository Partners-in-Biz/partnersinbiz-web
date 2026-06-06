import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { isClientVisibleToOrg } from '@/lib/client-documents/access'
import { normalizeClientDocumentLinks, validateClientDocumentLinks } from '@/lib/client-documents/linkedValidation'
import { CLIENT_DOCUMENTS_COLLECTION, createClientDocument } from '@/lib/client-documents/store'
import { themeFromOrg } from '@/lib/client-documents/themeFromOrg'
import type {
  ClientDocument,
  ClientDocumentLinkSet,
  ClientDocumentStatus,
  ClientDocumentType,
  DocumentAssumption,
  DocumentTheme,
} from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import type { Organization } from '@/lib/organizations/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

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

async function platformCompanyForClientOrg(clientOrgId: string): Promise<{ id: string } | null> {
  if (!clientOrgId || clientOrgId === PIB_PLATFORM_ORG_ID) return null
  const snap = await adminDb
    .collection('companies')
    .where('orgId', '==', PIB_PLATFORM_ORG_ID)
    .get()
  const match = snap.docs.find((doc) => {
    const data = doc.data() as { linkedOrgId?: string; deleted?: boolean }
    return data.deleted !== true && data.linkedOrgId === clientOrgId
  })
  return match ? { id: match.id } : null
}

async function companyForLinkedDocument(companyId: string): Promise<{ id: string; orgId: string; linkedOrgId?: string } | null> {
  if (!companyId) return null
  const snap = await adminDb.collection('companies').doc(companyId).get()
  if (!snap.exists) return null
  const data = snap.data() as { orgId?: string; linkedOrgId?: string; deleted?: boolean }
  if (data.deleted === true || !data.orgId) return null
  return {
    id: companyId,
    orgId: data.orgId,
    linkedOrgId: data.linkedOrgId,
  }
}

async function assertDocumentLinkTenantSafety(
  linked: ClientDocumentLinkSet,
  documentOrgId: string | undefined,
  user: ApiUser,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  for (const clientOrgId of linked.clientOrgIds ?? []) {
    if (!canAccessOrg(user, clientOrgId)) return { ok: false, error: `Forbidden linked client org: ${clientOrgId}`, status: 403 }
  }

  if (!documentOrgId) return { ok: true }

  for (const companyId of linked.companyIds ?? []) {
    const snap = await adminDb.collection('companies').doc(companyId).get()
    const data = snap.exists ? snap.data() as { orgId?: string; deleted?: boolean } : null
    if (!data || data.deleted === true || data.orgId !== documentOrgId) {
      return { ok: false, error: `linked.companyIds contains a company outside the document org: ${companyId}`, status: 400 }
    }
  }

  for (const contactId of linked.contactIds ?? []) {
    const snap = await adminDb.collection('contacts').doc(contactId).get()
    const data = snap.exists ? snap.data() as { orgId?: string; deleted?: boolean } : null
    if (!data || data.deleted === true || data.orgId !== documentOrgId) {
      return { ok: false, error: `linked.contactIds contains a contact outside the document org: ${contactId}`, status: 400 }
    }
  }

  return { ok: true }
}

function validateCreateAssumptions(
  value: unknown,
): { ok: true; value: CreateAssumptionInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'assumptions must be an array' }

  const assumptions: CreateAssumptionInput[] = []
  for (let index = 0; index < value.length; index += 1) {
    const assumption = value[index]
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

    const blockId = typeof row.blockId === 'string' ? row.blockId.trim() : undefined
    assumptions.push({
      text,
      ...(row.severity === undefined ? {} : { severity: row.severity as DocumentAssumption['severity'] }),
      ...(blockId ? { blockId } : {}),
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

  async function listForOrg(orgId: string): Promise<Array<ClientDocument & { id: string }>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).where('orgId', '==', orgId)
    if (status) query = query.where('status', '==', status)
    if (type) query = query.where('type', '==', type)
    const snap = await query.get()
    return snap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((doc: any) => ({ id: doc.id, ...doc.data() } as ClientDocument & { id: string }))
      .filter((doc: ClientDocument & { id: string }) => doc.deleted !== true)
  }

  let documents = await listForOrg(scope.orgId)
  if (scope.orgId !== PIB_PLATFORM_ORG_ID) {
    const platformDocuments = await listForOrg(PIB_PLATFORM_ORG_ID)
    const linkedPlatformDocuments = platformDocuments
      .filter((doc) => {
        const linkedOrgIds = new Set([
          ...(doc.linked?.clientOrgId ? [doc.linked.clientOrgId] : []),
          ...(doc.linked?.clientOrgIds ?? []),
        ])
        return linkedOrgIds.has(scope.orgId)
      })
      .filter((doc) => user.role !== 'client' || isClientVisibleToOrg(doc, scope.orgId))
    const byId = new Map<string, ClientDocument & { id: string }>()
    for (const document of [...documents, ...linkedPlatformDocuments]) byId.set(document.id, document)
    documents = Array.from(byId.values())
  }
  if (user.role === 'client') {
    documents = documents.filter((doc) => isClientVisibleToOrg(doc, scope.orgId))
  }

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
    const linkedResult = validateClientDocumentLinks(body.linked)
    if (linkedResult.ok === false) return apiError(linkedResult.error, 400)
    linked = linkedResult.value
  }

  let assumptions: CreateAssumptionInput[] = []
  if ('assumptions' in body) {
    const assumptionsResult = validateCreateAssumptions(body.assumptions)
    if (assumptionsResult.ok === false) return apiError(assumptionsResult.error, 400)
    assumptions = assumptionsResult.value
  }

  const platformCompany = orgId ? await platformCompanyForClientOrg(orgId) : null
  const linkedCompany = !orgId && linked.companyId ? await companyForLinkedDocument(linked.companyId) : null
  const documentOrgId = platformCompany ? PIB_PLATFORM_ORG_ID : linkedCompany?.orgId ?? orgId
  const rawDocumentLinked: ClientDocumentLinkSet = platformCompany
    ? {
        ...linked,
        companyId: linked.companyId || platformCompany.id,
        clientOrgId: linked.clientOrgId || orgId,
      }
    : linkedCompany
      ? {
          ...linked,
          companyId: linked.companyId || linkedCompany.id,
          ...(linkedCompany.linkedOrgId ? { clientOrgId: linked.clientOrgId || linkedCompany.linkedOrgId } : {}),
        }
      : linked

  const normalizedDocumentLinked = normalizeClientDocumentLinks(rawDocumentLinked)
  if (normalizedDocumentLinked.ok === false) return apiError(normalizedDocumentLinked.error, 400)
  const documentLinked = normalizedDocumentLinked.value
  const tenantSafety = await assertDocumentLinkTenantSafety(documentLinked, documentOrgId, user)
  if (tenantSafety.ok === false) return apiError(tenantSafety.error, tenantSafety.status)

  // Auto-populate the first version's theme from the org's brand colors. If
  // the request body supplied its own theme, that wins. If there is no orgId
  // (internal-only drafts) or the org has no brand colors yet, the store falls
  // back to the PiB default theme.
  let autoTheme: DocumentTheme | null = null
  const themeOrgId = documentLinked.clientOrgId || documentOrgId
  if (themeOrgId) {
    const orgSnap = await adminDb.collection('organizations').doc(themeOrgId).get()
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
    orgId: documentOrgId,
    linked: documentLinked,
    assumptions,
    user,
    theme: versionTheme,
  })

  return apiSuccess({ ...created, orgId: documentOrgId, linked: documentLinked, status: 'internal_draft', actorType: actorType(user) }, 201)
})
