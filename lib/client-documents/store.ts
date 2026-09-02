import { randomBytes } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'

import type { ApiUser } from '@/lib/api/types'
import { actorFrom, lastActorFrom, ownerUidFrom } from '@/lib/api/actor'
import { adminDb } from '@/lib/firebase/admin'
import {
  canMutateLinkedProjectPlanning,
  planningContextMutationTransition,
} from '@/lib/projects/planningDiscoveryStore'
import { clientVisibilityFieldsForWrite, companyFieldsForWrite } from '@/lib/work-scope'

import { serializeBlocksForFirestore } from './firestore-blocks'
import { createBlocksFromTemplate, getClientDocumentTemplate } from './templates'
import type {
  ClientDocument,
  ClientDocumentLinkSet,
  ClientDocumentType,
  DocumentActorType,
  DocumentAssumption,
  DocumentTheme,
} from './types'

export const CLIENT_DOCUMENTS_COLLECTION = 'client_documents'

const DEFAULT_THEME: DocumentTheme = {
  palette: {
    bg: '#0A0A0B',
    text: '#F7F4EE',
    accent: '#F5A623',
    muted: '#A3A3A3',
  },
  typography: {
    heading: 'Instrument Serif',
    body: 'Geist',
  },
}

type AssumptionInput = {
  text: string
  severity?: DocumentAssumption['severity']
  blockId?: string
}

type PlanningBlockerDetails = {
  code: 'planning_discovery_required'
  message: string
  revision: number
}

export class ClientDocumentPlanningError extends Error {
  readonly status = 409
  readonly details: PlanningBlockerDetails

  constructor(details: PlanningBlockerDetails) {
    super(details.message)
    this.name = 'ClientDocumentPlanningError'
    this.details = details
  }
}

export class ClientDocumentProjectAccessError extends Error {
  readonly status = 403
  readonly details = { code: 'project_access_denied' as const }

  constructor() {
    super('Linked project is not accessible')
    this.name = 'ClientDocumentProjectAccessError'
  }
}

export function isClientDocumentMutationError(
  error: unknown,
): error is ClientDocumentPlanningError | ClientDocumentProjectAccessError {
  return error instanceof ClientDocumentPlanningError || error instanceof ClientDocumentProjectAccessError
}

function actorType(user: ApiUser): DocumentActorType {
  // Ownership type follows actorFrom: user-delegation is always 'user'.
  return actorFrom(user).createdByType === 'agent' ? 'agent' : 'user'
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    (Object.entries(value) as Array<[keyof T, T[keyof T]]>).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>
}

function normalizeAssumptions(assumptions: AssumptionInput[] | undefined, user: ApiUser): DocumentAssumption[] {
  const createdAt = new Date().toISOString()
  const ownerUid = ownerUidFrom(user)
  const created = actorFrom(user)

  return (assumptions ?? [])
    .filter((assumption) => typeof assumption.text === 'string' && assumption.text.trim().length > 0)
    .map((assumption, index) =>
      withoutUndefined({
        id: `assumption-${index + 1}`,
        text: assumption.text.trim(),
        severity: assumption.severity ?? 'needs_review',
        status: 'open',
        blockId: assumption.blockId,
        createdBy: ownerUid || user.uid,
        ...(created.createdByAgentId ? { createdByAgentId: created.createdByAgentId } : {}),
        createdAt,
      }) as DocumentAssumption,
    )
}

function normalizeLinked(linked: ClientDocumentLinkSet | undefined): ClientDocumentLinkSet {
  return withoutUndefined(linked ?? {}) as ClientDocumentLinkSet
}

function linkedProjectIds(linked: ClientDocumentLinkSet | undefined): string[] {
  return Array.from(new Set([
    ...(typeof linked?.projectId === 'string' ? [linked.projectId] : []),
    ...(Array.isArray(linked?.projectIds) ? linked.projectIds : []),
  ].map((id) => id.trim()).filter(Boolean)))
}

export async function createClientDocument(input: {
  title: string
  type: ClientDocumentType
  orgId?: string
  linked?: ClientDocumentLinkSet
  assumptions?: AssumptionInput[]
  user: ApiUser
  theme?: DocumentTheme
  companyId?: string
  clientVisibility?: unknown
}): Promise<{ id: string; versionId: string; shareToken: string }> {
  const title = input.title.trim()

  if (!title) {
    throw new Error('title is required')
  }

  const template = getClientDocumentTemplate(input.type)
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc()
  const versionRef = documentRef.collection('versions').doc()
  const shareToken = randomBytes(12).toString('hex')
  const inputActorType = actorType(input.user)
  const createdActor = actorFrom(input.user)
  const now = FieldValue.serverTimestamp()

  const document = withoutUndefined({
    orgId: input.orgId,
    title,
    type: input.type,
    templateId: template.id,
    status: 'internal_draft',
    linked: normalizeLinked(input.linked),
    currentVersionId: versionRef.id,
    approvalMode: template.approvalMode,
    clientPermissions: { ...template.clientPermissions },
    assumptions: normalizeAssumptions(input.assumptions, input.user),
    shareToken,
    shareEnabled: false,
    ...companyFieldsForWrite(input.companyId || input.linked?.companyId),
    ...clientVisibilityFieldsForWrite(input.clientVisibility),
    createdAt: now,
    ...createdActor,
    updatedAt: now,
    updatedBy: createdActor.createdBy,
    updatedByType: createdActor.createdByType,
    ...(createdActor.createdByAgentId ? { updatedByAgentId: createdActor.createdByAgentId } : {}),
    deleted: false,
  }) as Omit<ClientDocument, 'id'>

  const version = {
    documentId: documentRef.id,
    versionNumber: 1,
    status: 'draft',
    blocks: serializeBlocksForFirestore(createBlocksFromTemplate(input.type)),
    theme: input.theme ?? DEFAULT_THEME,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: createdActor.createdBy,
    createdByType: inputActorType,
    ...(createdActor.createdByAgentId ? { createdByAgentId: createdActor.createdByAgentId } : {}),
    changeSummary: 'Initial draft',
  }

  const projectIds = linkedProjectIds(document.linked)
  if (projectIds.length === 0) {
    const batch = adminDb.batch()
    batch.set(documentRef, document)
    batch.set(versionRef, version)
    await batch.commit()
  } else {
    const projectRefs = projectIds.map((projectId) => adminDb.collection('projects').doc(projectId))
    const eventRefs = projectRefs.map((projectRef) => projectRef.collection('planningDiscoveryEvents').doc())
    const nowIso = new Date().toISOString()
    const result = await adminDb.runTransaction(async (transaction) => {
      const projectSnapshots = await Promise.all(projectRefs.map((projectRef) => transaction.get(projectRef)))
      const projects = projectSnapshots.map((snapshot) => snapshot.exists
        ? (snapshot.data() ?? {}) as Record<string, unknown>
        : null)
      if (projects.some((project) => !project)) {
        return { ok: false as const, accessDenied: true as const }
      }
      const accessChecks = await Promise.all(projects.map((project, index) => canMutateLinkedProjectPlanning(
        projectIds[index],
        project as Record<string, unknown>,
        input.user,
        { documentOrgId: input.orgId },
      )))
      if (accessChecks.some((allowed) => !allowed)) {
        return { ok: false as const, accessDenied: true as const }
      }

      const transitions = projects.map((project) => {
        const accessibleProject = project as Record<string, unknown>
        return {
          project: accessibleProject,
          transition: planningContextMutationTransition(accessibleProject, {
            uid: input.user.uid,
            now: nowIso,
            reason: 'client_document.created',
            reopenWhenReady: false,
          }),
        }
      })
      const blocked = transitions.find(({ transition }) => !transition.allowed)

      if (blocked && !blocked.transition.allowed) {
        transitions.forEach(({ project, transition }, index) => {
          if (!transition.allowed && transition.state) {
            transaction.update(projectRefs[index], {
              planningDiscovery: transition.state,
              updatedAt: FieldValue.serverTimestamp(),
            })
            if (transition.event) {
              transaction.set(eventRefs[index], {
                ...transition.event,
                projectId: projectIds[index],
                orgId: project.orgId ?? null,
                schemaVersion: 1,
                reason: 'client_document.created',
              })
            }
          }
        })
        return { ok: false as const, blocker: blocked.transition.blocker }
      }

      transaction.set(documentRef, document)
      transaction.set(versionRef, version)
      transitions.forEach(({ project, transition }, index) => {
        if (!transition.allowed) return
        if (transition.state) {
          transaction.update(projectRefs[index], {
            planningDiscovery: transition.state,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        if (transition.event) {
          transaction.set(eventRefs[index], {
            ...transition.event,
            projectId: projectIds[index],
            orgId: project.orgId ?? null,
            schemaVersion: 1,
            reason: 'client_document.created',
          })
        }
      })
      return { ok: true as const }
    })

    if (!result.ok) {
      if ('accessDenied' in result) throw new ClientDocumentProjectAccessError()
      throw new ClientDocumentPlanningError(result.blocker)
    }
  }

  return { id: documentRef.id, versionId: versionRef.id, shareToken }
}

export async function getClientDocument(id: string): Promise<(ClientDocument & { id: string }) | null> {
  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).get()

  if (!snap.exists || snap.data()?.deleted === true) {
    return null
  }

  return { id: snap.id, ...snap.data() } as ClientDocument & { id: string }
}

export async function publishClientDocument(
  id: string,
  user: ApiUser,
  expectedOrgId?: string | null,
  options: { acknowledgeMultiOrgPublish?: boolean } = {},
): Promise<{ id: string; versionId: string; clientOrgIds: string[]; multiOrgPublish: boolean }> {
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)

  return adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)

    if (!snap.exists || snap.data()?.deleted === true) {
      throw new Error('Document not found')
    }

    const document = snap.data() as ClientDocument

    if (expectedOrgId !== undefined && (document.orgId ?? null) !== expectedOrgId) {
      throw new Error('Document organisation changed before publishing')
    }

    if (!document.orgId) {
      throw new Error('orgId is required before publishing')
    }

    const blockers = (document.assumptions ?? []).filter(
      (assumption) => assumption.status === 'open' && assumption.severity === 'blocks_publish',
    )

    if (blockers.length > 0) {
      throw new Error('Resolve blocking assumptions before publishing')
    }

    const { sanitizeRecipientClientOrgIds } = await import('@/lib/client-documents/holder')
    const clientOrgIds = sanitizeRecipientClientOrgIds(document.orgId, [
      ...(document.linked?.clientOrgId ? [document.linked.clientOrgId] : []),
      ...(document.linked?.clientOrgIds ?? []),
    ])

    if (clientOrgIds.length === 0) {
      throw new Error(
        'Explicit linked client organisation is required before publishing (must not be the platform holder org alone)',
      )
    }

    if (clientOrgIds.length > 1 && options.acknowledgeMultiOrgPublish !== true) {
      throw new Error('Publishing to multiple client orgs requires explicit acknowledgement')
    }

    const versionRef = documentRef.collection('versions').doc(document.currentVersionId)

    transaction.update(documentRef, {
      status: 'client_review',
      latestPublishedVersionId: document.currentVersionId,
      shareEnabled: true,
      ...lastActorFrom(user),
    })
    transaction.update(versionRef, { status: 'published' })

    return {
      id,
      versionId: document.currentVersionId,
      clientOrgIds,
      multiOrgPublish: clientOrgIds.length > 1,
    }
  })
}
