import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  assertClientDocumentDataAccess,
  canManageClientDocument,
  getAccessibleClientDocument,
} from '@/lib/client-documents/access'
import {
  assertRecipientShareEligible,
  revokeUserShares,
  upsertUserShares,
  validateRevokeUserShareInput,
  validateUserShareInput,
} from '@/lib/client-documents/grants'
import { syncUserShareDocumentGrants } from '@/lib/client-documents/canonical-grants'
import { revokeDocumentSignedArtifactAccess } from '@/lib/client-documents/artifact-revocation'
import { lastActorFrom } from '@/lib/api/actor'
import { validateClientDocumentLinks } from '@/lib/client-documents/linkedValidation'
import { CLIENT_DOCUMENTS_COLLECTION, getClientDocument } from '@/lib/client-documents/store'
import type { ClientDocument, DocumentAssumption } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  canMutateLinkedProjectPlanning,
  planningContextMutationTransition,
} from '@/lib/projects/planningDiscoveryStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const PATCH_FIELDS = new Set(['title', 'linked', 'assumptions', 'shareEnabled', 'userShares', 'revokeUserShares'])
const ASSUMPTION_FIELDS = new Set([
  'id',
  'text',
  'severity',
  'status',
  'blockId',
  'createdBy',
  'createdAt',
  'resolvedBy',
  'resolvedAt',
])
const ASSUMPTION_SEVERITIES = new Set(['info', 'needs_review', 'blocks_publish'])
const ASSUMPTION_STATUSES = new Set(['open', 'resolved'])

function linkedProjectIds(linked: ClientDocument['linked'] | undefined): string[] {
  return Array.from(new Set([
    ...(typeof linked?.projectId === 'string' ? [linked.projectId] : []),
    ...(Array.isArray(linked?.projectIds) ? linked.projectIds : []),
  ].map((id) => id.trim()).filter(Boolean)))
}

async function applyLinkedProjectPlanningMutation(
  transaction: FirebaseFirestore.Transaction,
  projectIds: string[],
  user: ApiUser,
  documentOrgId: string | undefined,
  reason: string,
  documentId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (projectIds.length === 0) return { ok: true }

  const projectRefs = projectIds.map((projectId) => adminDb.collection('projects').doc(projectId))
  const eventRefs = projectRefs.map((projectRef) => projectRef.collection('planningDiscoveryEvents').doc())
  const projectSnapshots = await Promise.all(projectRefs.map((projectRef) => transaction.get(projectRef)))
  const now = new Date().toISOString()
  const projects = projectSnapshots.map((snapshot) => snapshot.exists
    ? (snapshot.data() ?? {}) as Record<string, unknown>
    : null)
  if (projects.some((project) => !project)) {
    return {
      ok: false,
      response: apiError('Linked project is not accessible', 403, { code: 'project_access_denied' }),
    }
  }
  const accessChecks = await Promise.all(projects.map((project, index) => canMutateLinkedProjectPlanning(
    projectIds[index],
    project as Record<string, unknown>,
    user,
    {
      documentOrgId,
      item: documentId,
    },
  )))
  if (accessChecks.some((allowed) => !allowed)) {
    return {
      ok: false,
      response: apiError('Linked project is not accessible', 403, { code: 'project_access_denied' }),
    }
  }

  const transitions = projects.map((project) => {
    const accessibleProject = project as Record<string, unknown>
    return {
      ok: true as const,
      project: accessibleProject,
      transition: planningContextMutationTransition(accessibleProject, { uid: user.uid, now, reason }),
    }
  })

  const blocked = transitions.find((item) => item.ok && !item.transition.allowed)
  if (blocked?.ok && !blocked.transition.allowed) {
    transitions.forEach((item, index) => {
      if (item.ok && !item.transition.allowed && item.transition.state) {
        transaction.update(projectRefs[index], {
          planningDiscovery: item.transition.state,
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (item.transition.event) {
          transaction.set(eventRefs[index], {
            ...item.transition.event,
            projectId: projectIds[index],
            orgId: item.project.orgId ?? null,
            schemaVersion: 1,
            reason,
          })
        }
      }
    })
    return { ok: false, response: apiError(blocked.transition.blocker.message, 409, blocked.transition.blocker) }
  }

  transitions.forEach((item, index) => {
    if (!item.ok || !item.transition.allowed) return
    transaction.update(projectRefs[index], {
      planningDiscovery: item.transition.state,
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(eventRefs[index], {
      ...item.transition.event,
      projectId: projectIds[index],
      orgId: item.project.orgId ?? null,
      schemaVersion: 1,
      reason,
    })
  })
  return { ok: true }
}

async function assertPatchLinkTenantSafety(
  linked: ClientDocument['linked'],
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

function validateAssumptions(
  value: unknown,
): { ok: true; value: DocumentAssumption[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'assumptions must be an array' }

  for (let index = 0; index < value.length; index += 1) {
    const assumption = value[index]
    if (!assumption || typeof assumption !== 'object' || Array.isArray(assumption)) {
      return { ok: false, error: `assumptions[${index}] must be an object` }
    }

    const row = assumption as Record<string, unknown>
    const unknownFields = Object.keys(row).filter((field) => !ASSUMPTION_FIELDS.has(field))
    if (unknownFields.length > 0) {
      return { ok: false, error: `assumptions[${index}] contains unsupported field(s): ${unknownFields.join(', ')}` }
    }

    for (const field of ['id', 'text', 'createdBy']) {
      if (typeof row[field] !== 'string') {
        return { ok: false, error: `assumptions[${index}].${field} must be a string` }
      }
    }

    if (typeof row.severity !== 'string' || !ASSUMPTION_SEVERITIES.has(row.severity)) {
      return { ok: false, error: `assumptions[${index}].severity must be one of: info, needs_review, blocks_publish` }
    }

    if (typeof row.status !== 'string' || !ASSUMPTION_STATUSES.has(row.status)) {
      return { ok: false, error: `assumptions[${index}].status must be one of: open, resolved` }
    }

    for (const field of ['blockId', 'resolvedBy', 'createdAt', 'resolvedAt']) {
      if (field in row && row[field] !== undefined && typeof row[field] !== 'string') {
        return { ok: false, error: `assumptions[${index}].${field} must be a string` }
      }
    }
  }

  return { ok: true, value: value as DocumentAssumption[] }
}

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  return apiSuccess(access.document)
})

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const invalidFields = Object.keys(body).filter((field) => !PATCH_FIELDS.has(field))
  if (invalidFields.length > 0) {
    return apiError(`Unsupported field(s): ${invalidFields.join(', ')}`, 400)
  }

  const update: Record<string, unknown> = { ...lastActorFrom(user) }

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return apiError('title cannot be empty', 400)
    update.title = title
  }

  if ('linked' in body) {
    const linked = validateClientDocumentLinks(body.linked)
    if (linked.ok === false) return apiError(linked.error, 400)
    update.linked = linked.value
  }

  if ('assumptions' in body) {
    const assumptions = validateAssumptions(body.assumptions)
    if (assumptions.ok === false) return apiError(assumptions.error, 400)
    update.assumptions = assumptions.value
  }

  if ('shareEnabled' in body) {
    if (typeof body.shareEnabled !== 'boolean') return apiError('shareEnabled must be a boolean', 400)
    update.shareEnabled = body.shareEnabled
  }

  const userShares = 'userShares' in body ? validateUserShareInput(body.userShares) : null
  if (userShares && !userShares.ok) return apiError(userShares.error, 400)
  const userShareRevocations = 'revokeUserShares' in body ? validateRevokeUserShareInput(body.revokeUserShares) : null
  if (userShareRevocations && !userShareRevocations.ok) return apiError(userShareRevocations.error, 400)

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)
    if (!snap.exists || snap.data()?.deleted === true) {
      return { ok: false as const, response: apiError('Document not found', 404) }
    }

    const document = snap.data() as Partial<ClientDocument>
    const access = assertClientDocumentDataAccess(document, user)
    if (!access.ok) return access
    if (!canManageClientDocument(snap.data() as Partial<ClientDocument>, user)) {
      return { ok: false as const, response: apiError('Only the document creator can manage member sharing', 403) }
    }

    if (userShares?.ok) {
      for (const share of userShares.value) {
        const eligibility = await assertRecipientShareEligible(document, share)
        if (!eligibility.ok) return { ok: false as const, response: apiError(eligibility.error, eligibility.status) }
      }
      const granted = upsertUserShares(document.userShares, userShares.value, user)
      update.userShares = granted.shares
      update.userShareUserIds = granted.userShareUserIds
    }
    if (userShareRevocations?.ok) {
      const revoked = revokeUserShares(document.userShares, userShareRevocations.value, user)
      update.userShares = revoked.shares
      update.userShareUserIds = revoked.userShareUserIds
    }

    if (update.linked) {
      const tenantSafety = await assertPatchLinkTenantSafety(update.linked as ClientDocument['linked'], document.orgId, user)
      if (tenantSafety.ok === false) return { ok: false as const, response: apiError(tenantSafety.error, tenantSafety.status) }
    }

    const projectIds = Array.from(new Set([
      ...linkedProjectIds(document.linked),
      ...linkedProjectIds(update.linked as ClientDocument['linked'] | undefined),
    ]))
    const planning = await applyLinkedProjectPlanningMutation(
      transaction,
      projectIds,
      user,
      document.orgId,
      'client_document.updated',
      id,
    )
    if (!planning.ok) return planning

    transaction.update(documentRef, update)
    return { ok: true as const }
  })

  if (!result.ok) return result.response

  if (userShares?.ok || userShareRevocations?.ok || update.linked) {
    const updatedDocument = await getClientDocument(id)
    if (!updatedDocument) return apiError('Document not found', 404)
    await syncUserShareDocumentGrants(updatedDocument, user)
  }

  if (update.shareEnabled === false || userShareRevocations?.ok) {
    await revokeDocumentSignedArtifactAccess(id).catch(() => undefined)
  }

  return apiSuccess({ id, updated: Object.keys(update) })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)

  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)
    if (!snap.exists || snap.data()?.deleted === true) {
      return { ok: false as const, response: apiError('Document not found', 404) }
    }

    const document = snap.data() as Partial<ClientDocument>
    const access = assertClientDocumentDataAccess(document, user)
    if (!access.ok) return access

    const planning = await applyLinkedProjectPlanningMutation(
      transaction,
      linkedProjectIds(document.linked),
      user,
      document.orgId,
      'client_document.deleted',
      id,
    )
    if (!planning.ok) return planning

    transaction.update(documentRef, {
      status: 'archived',
      deleted: true,
      ...lastActorFrom(user),
    })

    return { ok: true as const }
  })

  if (!result.ok) return result.response

  return apiSuccess({ id, status: 'archived' })
})
