import { NextRequest } from 'next/server'

import { actorFrom } from '@/lib/api/actor'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { isClientDocumentVisibleToUser, isClientVisibleClientDocument } from '@/lib/client-documents/access'
import { normalizeClientDocumentLinks, validateClientDocumentLinks } from '@/lib/client-documents/linkedValidation'
import {
  CLIENT_DOCUMENTS_COLLECTION,
  createClientDocument,
  isClientDocumentMutationError,
} from '@/lib/client-documents/store'
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
import { filterOwnedRowsForActor } from '@/lib/orgMembers/record-scope'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import type { Organization } from '@/lib/organizations/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { resolveWorkScopeFromRequest, resolveWorkScopeFromSearchParams, recordVisibleForWorkScope } from '@/lib/work-scope'

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
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

type CreateAssumptionInput = {
  text: string
  severity?: DocumentAssumption['severity']
  blockId?: string
}

type FirestoreListDoc = {
  id: string
  data: () => Record<string, unknown>
}

type FirestoreListSnap = {
  docs: FirestoreListDoc[]
}

type FirestoreListQuery = {
  where: (fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown) => FirestoreListQuery
  limit: (limit: number) => FirestoreListQuery
  get: () => Promise<FirestoreListSnap>
}

function actorType(user: ApiUser) {
  return actorFrom(user).createdByType === 'agent' ? 'agent' : 'user'
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

/**
 * PiB staff are often named on a client-company chat without joining that org.
 * Allow the client org as a document *recipient* scope when a platform CRM
 * company is linked to it; holder remapping still puts drafts on the platform.
 */
async function resolveClientDocumentOrgScope(
  user: ApiUser,
  requestedOrgId: string | null,
): Promise<ReturnType<typeof resolveOrgScope>> {
  const scope = resolveOrgScope(user, requestedOrgId)
  if (scope.ok) return scope
  if (scope.status !== 403 || user.role !== 'client') return scope
  const requested = typeof requestedOrgId === 'string' ? requestedOrgId.trim() : ''
  if (!requested || requested === PIB_PLATFORM_ORG_ID) return scope
  const staff = await loadPlatformStaffMembership(user.uid)
  if (!staff) return scope
  const company = await platformCompanyForClientOrg(requested)
  if (!company) return scope
  return { ok: true, orgId: requested }
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
  const staff = user.role === 'client' ? await loadPlatformStaffMembership(user.uid) : null
  const linkedClientOrgIds = Array.from(new Set([
    ...(typeof linked.clientOrgId === 'string' && linked.clientOrgId.trim() ? [linked.clientOrgId.trim()] : []),
    ...(linked.clientOrgIds ?? []).filter((id): id is string => typeof id === 'string' && Boolean(id.trim())),
  ]))
  for (const clientOrgId of linkedClientOrgIds) {
    if (canAccessOrg(user, clientOrgId)) continue
    // Platform-held docs may link a client org the staff member is serving
    // without requiring client-org membership.
    if (staff && documentOrgId === staff.platformOrgId) {
      const company = await platformCompanyForClientOrg(clientOrgId)
      if (company) continue
    }
    return { ok: false, error: `Forbidden linked client org: ${clientOrgId}`, status: 403 }
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
  const scope = await resolveClientDocumentOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const parsedLimit = Number.parseInt(searchParams.get('limit') ?? `${DEFAULT_LIST_LIMIT}`, 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT

  const status = searchParams.get('status')
  if (status && !VALID_STATUSES.includes(status as ClientDocumentStatus)) {
    return apiError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400)
  }

  const type = searchParams.get('type')
  if (type && !VALID_TYPES.includes(type as ClientDocumentType)) {
    return apiError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400)
  }

  async function listForOrg(orgId: string): Promise<Array<ClientDocument & { id: string }>> {
    let query = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
      .where('orgId', '==', orgId) as unknown as FirestoreListQuery
    if (status) query = query.where('status', '==', status)
    if (type) query = query.where('type', '==', type)
    query = query.limit(limit + 1)
    const snap = await query.get()
    return snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as ClientDocument & { id: string }))
      .filter((doc: ClientDocument & { id: string }) => doc.deleted !== true)
  }

  /** Client members must never lose their own/shared drafts to the unbounded org scan + limit. */
  async function listOwnedOrSharedForOrg(orgId: string): Promise<Array<ClientDocument & { id: string }>> {
    if (user.role !== 'client') return []
    const base = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
      .where('orgId', '==', orgId) as unknown as FirestoreListQuery
    let ownedQuery = base.where('createdBy', '==', user.uid) as unknown as FirestoreListQuery
    let sharedQuery = base.where('userShareUserIds', 'array-contains', user.uid) as unknown as FirestoreListQuery
    if (status) {
      ownedQuery = ownedQuery.where('status', '==', status)
      sharedQuery = sharedQuery.where('status', '==', status)
    }
    if (type) {
      ownedQuery = ownedQuery.where('type', '==', type)
      sharedQuery = sharedQuery.where('type', '==', type)
    }
    ownedQuery = ownedQuery.limit(MAX_LIST_LIMIT)
    sharedQuery = sharedQuery.limit(MAX_LIST_LIMIT)
    const [ownedSnap, sharedSnap] = await Promise.all([ownedQuery.get(), sharedQuery.get()])
    return [...ownedSnap.docs, ...sharedSnap.docs]
      .map((doc) => ({ id: doc.id, ...doc.data() } as ClientDocument & { id: string }))
      .filter((doc) => doc.deleted !== true)
  }

  // Client-role users must never receive a full holder-org scan of platform docs
  // (membership of pib-platform-owner used to dump every proposal). Start from
  // owned/shared + recipient-linked client-facing platform docs only.
  let documents: Array<ClientDocument & { id: string }> = []
  if (user.role === 'client') {
    const staff = scope.orgId !== PIB_PLATFORM_ORG_ID
      ? await loadPlatformStaffMembership(user.uid)
      : null
    const ownedOrShared = [
      ...(await listOwnedOrSharedForOrg(scope.orgId)),
      // PiB staff drafts live on the platform holder even when listing from a client chat.
      ...(staff ? await listOwnedOrSharedForOrg(PIB_PLATFORM_ORG_ID) : []),
    ]
    // Platform-held docs explicitly addressed to this client org (or any of the
    // caller's client orgs if they list under a non-platform scope).
    const recipientOrgIds = Array.from(new Set([
      ...(scope.orgId !== PIB_PLATFORM_ORG_ID ? [scope.orgId] : []),
      ...((user.orgIds ?? []).filter((id) => id && id !== PIB_PLATFORM_ORG_ID)),
      ...((user.orgId && user.orgId !== PIB_PLATFORM_ORG_ID) ? [user.orgId] : []),
    ].filter(Boolean)))

    const platformQueries: FirestoreListQuery[] = []
    for (const recipientOrgId of recipientOrgIds) {
      platformQueries.push(
        adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
          .where('orgId', '==', PIB_PLATFORM_ORG_ID)
          .where('linked.clientOrgId', '==', recipientOrgId) as unknown as FirestoreListQuery,
        adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
          .where('orgId', '==', PIB_PLATFORM_ORG_ID)
          .where('linked.clientOrgIds', 'array-contains', recipientOrgId) as unknown as FirestoreListQuery,
      )
    }
    // Client-org held docs (holder is the client workspace itself).
    if (scope.orgId !== PIB_PLATFORM_ORG_ID) {
      documents = await listForOrg(scope.orgId)
    }

    const platformSnaps = platformQueries.length > 0
      ? await Promise.all(platformQueries.map((query) => {
          let nextQuery = query
          if (status) nextQuery = nextQuery.where('status', '==', status)
          if (type) nextQuery = nextQuery.where('type', '==', type)
          return nextQuery.limit(limit + 1).get()
        }))
      : []
    const linkedPlatformDocuments = platformSnaps.flatMap((snap) =>
      snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ClientDocument & { id: string })),
    )
      .filter((doc) => doc.deleted !== true)
      .filter((doc) => isClientVisibleClientDocument(doc) || isClientDocumentVisibleToUser(doc, user))

    const byId = new Map<string, ClientDocument & { id: string }>()
    for (const document of [...documents, ...ownedOrShared, ...linkedPlatformDocuments]) {
      // When listing from a client chat, keep platform-owned drafts that are
      // linked to this client (or unlinked personal drafts for this staff user).
      if (
        staff
        && document.orgId === PIB_PLATFORM_ORG_ID
        && document.createdBy === user.uid
      ) {
        const linkedIds = [
          ...(document.linked?.clientOrgId ? [document.linked.clientOrgId] : []),
          ...(document.linked?.clientOrgIds ?? []),
        ].filter(Boolean)
        if (linkedIds.length > 0 && !linkedIds.includes(scope.orgId)) continue
      }
      byId.set(document.id, document)
    }
    documents = Array.from(byId.values()).filter((doc) => isClientDocumentVisibleToUser(doc, user))
  } else {
    documents = await listForOrg(scope.orgId)
    if (scope.orgId !== PIB_PLATFORM_ORG_ID) {
      const platformQueries: FirestoreListQuery[] = [
        adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
          .where('orgId', '==', PIB_PLATFORM_ORG_ID)
          .where('linked.clientOrgId', '==', scope.orgId) as unknown as FirestoreListQuery,
        adminDb.collection(CLIENT_DOCUMENTS_COLLECTION)
          .where('orgId', '==', PIB_PLATFORM_ORG_ID)
          .where('linked.clientOrgIds', 'array-contains', scope.orgId) as unknown as FirestoreListQuery,
      ]
      const platformSnaps = await Promise.all(platformQueries.map((query) => {
        let nextQuery = query
        if (status) nextQuery = nextQuery.where('status', '==', status)
        if (type) nextQuery = nextQuery.where('type', '==', type)
        return nextQuery.limit(limit + 1).get()
      }))
      const platformDocuments = platformSnaps.flatMap((snap) =>
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ClientDocument & { id: string })),
      )
      const linkedPlatformDocuments = platformDocuments
        .filter((doc) => doc.deleted !== true)
        .filter((doc) => {
          const linkedOrgIds = new Set([
            ...(doc.linked?.clientOrgId ? [doc.linked.clientOrgId] : []),
            ...(doc.linked?.clientOrgIds ?? []),
          ])
          return linkedOrgIds.has(scope.orgId)
        })
        .filter((doc) => isClientVisibleClientDocument(doc))
      const byId = new Map<string, ClientDocument & { id: string }>()
      for (const document of [...documents, ...linkedPlatformDocuments]) byId.set(document.id, document)
      documents = Array.from(byId.values())
    }
  }
  // Members with an owned_or_linked documents scope see only their own /
  // shared / CRM-linked rows; admins, agents and 'all'-scoped members pass
  // through unchanged (the client branch already scopes to owned/shared).
  documents = await filterOwnedRowsForActor(user, scope.orgId, 'documents', documents)
  const workScope = resolveWorkScopeFromSearchParams(searchParams, user.uid)
  if (workScope.owner === 'company') {
    const wanted = workScope.companyId ?? ''
    documents = documents.filter((doc) => (
      recordVisibleForWorkScope(doc as unknown as Record<string, unknown>, workScope)
      || doc.linked?.companyId === wanted
      || Boolean(doc.linked?.companyIds?.includes(wanted))
    ))
  }
  const hasMore = documents.length > limit
  const total = hasMore ? limit + 1 : documents.length
  documents = documents.slice(0, limit)

  return apiSuccess(documents, 200, { total, limit, hasMore })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  if (!VALID_TYPES.includes(body.type)) {
    return apiError(`type must be one of: ${VALID_TYPES.join(', ')}`, 400)
  }

  let orgId: string | undefined
  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  if (requestedOrgId || user.role === 'client') {
    const scope = await resolveClientDocumentOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    orgId = scope.orgId
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

  // Holder model: document lives under PiB (or the company holder org), not the
  // recipient client org. Client org is recorded on linked.clientOrgId only.
  const platformCompany = orgId ? await platformCompanyForClientOrg(orgId) : null
  const companyFromLink = typeof linked.companyId === 'string' && linked.companyId.trim()
    ? await companyForLinkedDocument(linked.companyId.trim())
    : null
  const {
    resolveDocumentHolderOrgId,
    resolveDocumentRecipientClientOrgId,
  } = await import('@/lib/client-documents/holder')
  const documentOrgId = resolveDocumentHolderOrgId({
    requestedOrgId: orgId,
    platformCompanyIdForClientOrg: platformCompany?.id ?? null,
    linkedCompany: companyFromLink,
    creatorHomeOrgId: user.activeOrgId || user.orgId || null,
  })
  // Gate create on the holder org (platform for PiB staff client chats), not the
  // recipient client org the staff member may not belong to.
  if (documentOrgId) {
    const createAccess = await assertUserCanPerformOrganizationModuleAction(
      user,
      documentOrgId,
      'documents',
      'create',
      'Document creation is disabled for your organisation role',
    )
    if (!createAccess.ok) return apiError(createAccess.error, createAccess.status)
  }
  // Never stamp the holder org as linked.clientOrgId — that makes client_review
  // docs invisible to the real client organisation (Saaiman Stays bug).
  const recipientClientOrgId = resolveDocumentRecipientClientOrgId({
    holderOrgId: documentOrgId,
    linkedClientOrgId: typeof linked.clientOrgId === 'string' ? linked.clientOrgId : orgId,
    linkedClientOrgIds: linked.clientOrgIds,
    companyLinkedOrgId: companyFromLink?.linkedOrgId,
  })
  const rawDocumentLinked: ClientDocumentLinkSet = {
    ...linked,
    ...(platformCompany || companyFromLink
      ? { companyId: linked.companyId || platformCompany?.id || companyFromLink?.id }
      : {}),
    ...(recipientClientOrgId
      ? {
          clientOrgId: recipientClientOrgId,
          clientOrgIds: Array.from(new Set([
            ...(linked.clientOrgIds ?? []).filter((id) => id && id !== documentOrgId),
            recipientClientOrgId,
          ])),
        }
      : {
          // Drop accidental holder-as-client stamps from the request body.
          ...(linked.clientOrgId && linked.clientOrgId === documentOrgId
            ? { clientOrgId: undefined }
            : {}),
        }),
  }

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
  const workScope = resolveWorkScopeFromRequest({
    searchParams: new URL(req.url).searchParams,
    body: body as Record<string, unknown>,
    uid: user.uid,
  })
  const workCompanyId = workScope.owner === 'company' ? workScope.companyId : documentLinked.companyId

  let created: Awaited<ReturnType<typeof createClientDocument>>
  try {
    created = await createClientDocument({
      title,
      type: body.type,
      orgId: documentOrgId,
      linked: documentLinked,
      assumptions,
      user,
      theme: versionTheme,
      companyId: workCompanyId,
      clientVisibility: (body as Record<string, unknown>).clientVisibility,
    })
  } catch (error) {
    if (isClientDocumentMutationError(error)) {
      return apiError(error.message, error.status, error.details)
    }
    throw error
  }

  // Messages Context Dock: auto-attach open_context when this create is from a chat turn.
  const handoffOrgId = documentOrgId ?? orgId
  const handoffIds = handoffOrgId
    ? (await import('@/lib/messages/openContextHandoff')).parseMessagesHandoffIds(body as Record<string, unknown>)
    : { conversationId: null, responseMessageId: null }
  const handoff = handoffOrgId && handoffIds.conversationId && handoffIds.responseMessageId
    ? await import('@/lib/messages/openContextHandoff')
      .then((mod) => mod.handoffOpenContextFromCreate({
        orgId: handoffOrgId,
        body: body as Record<string, unknown>,
        kind: 'document',
        id: created.id,
        label: title,
        summary: `status: internal_draft | type: ${body.type}`,
      }))
      .catch(() => null)
    : null

  return apiSuccess({
    ...created,
    orgId: documentOrgId,
    linked: documentLinked,
    status: 'internal_draft',
    actorType: actorType(user),
    ...(handoff ? {
      contextRef: handoff.contextRef,
      uiActions: handoff.uiActions,
      messagesAttach: handoff.messagesAttach,
    } : {}),
  }, 201)
})
