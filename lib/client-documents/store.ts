import { randomBytes } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'

import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'

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

function actorType(user: ApiUser): DocumentActorType {
  return user.role === 'ai' ? 'agent' : 'user'
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    (Object.entries(value) as Array<[keyof T, T[keyof T]]>).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>
}

function normalizeAssumptions(assumptions: AssumptionInput[] | undefined, user: ApiUser): DocumentAssumption[] {
  const createdAt = new Date().toISOString()

  return (assumptions ?? [])
    .filter((assumption) => typeof assumption.text === 'string' && assumption.text.trim().length > 0)
    .map((assumption, index) =>
      withoutUndefined({
        id: `assumption-${index + 1}`,
        text: assumption.text.trim(),
        severity: assumption.severity ?? 'needs_review',
        status: 'open',
        blockId: assumption.blockId,
        createdBy: user.uid,
        createdAt,
      }) as DocumentAssumption,
    )
}

function normalizeLinked(linked: ClientDocumentLinkSet | undefined): ClientDocumentLinkSet {
  return withoutUndefined(linked ?? {}) as ClientDocumentLinkSet
}

export async function createClientDocument(input: {
  title: string
  type: ClientDocumentType
  orgId?: string
  linked?: ClientDocumentLinkSet
  assumptions?: AssumptionInput[]
  user: ApiUser
  theme?: DocumentTheme
}): Promise<{ id: string; versionId: string; shareToken: string }> {
  const title = input.title.trim()

  if (!title) {
    throw new Error('title is required')
  }

  const template = getClientDocumentTemplate(input.type)
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc()
  const versionRef = documentRef.collection('versions').doc()
  const batch = adminDb.batch()
  const shareToken = randomBytes(12).toString('hex')
  const inputActorType = actorType(input.user)
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
    createdAt: now,
    createdBy: input.user.uid,
    createdByType: inputActorType,
    updatedAt: now,
    updatedBy: input.user.uid,
    updatedByType: inputActorType,
    deleted: false,
  }) as Omit<ClientDocument, 'id'>

  const version = {
    documentId: documentRef.id,
    versionNumber: 1,
    status: 'draft',
    blocks: serializeBlocksForFirestore(createBlocksFromTemplate(input.type)),
    theme: input.theme ?? DEFAULT_THEME,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.user.uid,
    createdByType: inputActorType,
    changeSummary: 'Initial draft',
  }

  batch.set(documentRef, document)
  batch.set(versionRef, version)
  await batch.commit()

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
): Promise<{ id: string; versionId: string }> {
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

    const versionRef = documentRef.collection('versions').doc(document.currentVersionId)

    transaction.update(documentRef, {
      status: 'client_review',
      latestPublishedVersionId: document.currentVersionId,
      shareEnabled: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByType: actorType(user),
    })
    transaction.update(versionRef, { status: 'published' })

    return { id, versionId: document.currentVersionId }
  })
}
