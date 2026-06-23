import { FieldValue } from 'firebase-admin/firestore'

import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'

import { getAccessibleClientDocument } from './access'
import { deserializeBlocksFromFirestore, serializeBlocksForFirestore } from './firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from './store'
import type {
  ClientDocumentVersion,
  DocumentActorType,
  DocumentBlock,
  DocumentTheme,
  UserDocumentTemplate,
} from './types'

export const USER_TEMPLATES_COLLECTION = 'user_document_templates'

function actorType(user: ApiUser): DocumentActorType {
  return user.role === 'ai' ? 'agent' : 'user'
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    (Object.entries(value) as Array<[keyof T, T[keyof T]]>).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>
}

function userOrgIds(user: ApiUser): string[] {
  return user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
}

/**
 * Whether `user` is allowed to read/delete the supplied template. Creators
 * always have access. Otherwise the template's org must fall within the user's
 * accessible org scope. AI/admin (super admins) with no org restriction can
 * access org-less (global) templates.
 */
function canAccessUserTemplate(template: Pick<UserDocumentTemplate, 'orgId' | 'createdBy'>, user: ApiUser): boolean {
  if (template.createdBy === user.uid) return true
  if (template.orgId) {
    return userOrgIds(user).includes(template.orgId) || user.role === 'ai'
  }
  // Org-less / global templates are visible to non-client platform operators.
  return user.role === 'admin' || user.role === 'ai'
}

type UserTemplateRecord = UserDocumentTemplate & { id: string }

function hydrateTemplate(id: string, data: Record<string, unknown>): UserTemplateRecord {
  return {
    ...(data as Omit<UserDocumentTemplate, 'id' | 'blocks'>),
    id,
    blocks: deserializeBlocksFromFirestore(data.blocks),
  } as UserTemplateRecord
}

/**
 * Create a saved template from the current version of an existing document.
 * Loads the document's current version blocks + theme and writes them into a
 * new `user_document_templates` doc. Caller must be admin (route-enforced) and
 * have access to the source document.
 */
export async function createUserTemplateFromDocument(input: {
  name: string
  description?: string
  orgId?: string
  documentId: string
  user: ApiUser
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name is required', status: 400 }

  const access = await getAccessibleClientDocument(input.documentId, input.user)
  if (!access.ok) {
    return { ok: false, error: 'Document not found or not accessible', status: 404 }
  }

  const document = access.document
  const versionSnap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(input.documentId)
    .collection('versions')
    .doc(document.currentVersionId)
    .get()

  if (!versionSnap.exists) {
    return { ok: false, error: 'Document has no current version to template', status: 404 }
  }

  const version = versionSnap.data() as ClientDocumentVersion
  const blocks = deserializeBlocksFromFirestore(version.blocks)
  const theme = version.theme as DocumentTheme | undefined

  // Prefer the explicit orgId, falling back to the source document's org so the
  // template stays scoped to the same tenant it was authored from.
  const orgId =
    typeof input.orgId === 'string' && input.orgId.trim()
      ? input.orgId.trim()
      : document.orgId

  const ref = adminDb.collection(USER_TEMPLATES_COLLECTION).doc()
  const inputActorType = actorType(input.user)
  const now = FieldValue.serverTimestamp()

  const record = withoutUndefined({
    orgId,
    name,
    description: input.description?.trim() || undefined,
    type: document.type,
    blocks: serializeBlocksForFirestore(blocks),
    theme,
    createdBy: input.user.uid,
    createdByType: inputActorType,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  })

  await ref.set(record)

  return { ok: true, id: ref.id }
}

/**
 * List the saved templates accessible to `user`. When `orgId` is supplied the
 * list is filtered to that org (caller must already have asserted access). When
 * omitted, returns templates the user created plus templates in any org within
 * the user's scope.
 */
export async function listUserTemplates(input: {
  user: ApiUser
  orgId?: string | null
}): Promise<UserTemplateRecord[]> {
  const { user, orgId } = input

  if (orgId) {
    const snap = await adminDb.collection(USER_TEMPLATES_COLLECTION).where('orgId', '==', orgId).get()
    return snap.docs
      .map((doc) => hydrateTemplate(doc.id, doc.data()))
      .filter((tpl) => tpl.deleted !== true)
  }

  const byId = new Map<string, UserTemplateRecord>()

  // Templates created by this user (covers org-less / global ones too).
  const mineSnap = await adminDb
    .collection(USER_TEMPLATES_COLLECTION)
    .where('createdBy', '==', user.uid)
    .get()
  for (const doc of mineSnap.docs) {
    const tpl = hydrateTemplate(doc.id, doc.data())
    if (tpl.deleted !== true) byId.set(tpl.id, tpl)
  }

  // Templates in any org within the user's scope.
  for (const scopedOrgId of userOrgIds(user)) {
    const snap = await adminDb
      .collection(USER_TEMPLATES_COLLECTION)
      .where('orgId', '==', scopedOrgId)
      .get()
    for (const doc of snap.docs) {
      const tpl = hydrateTemplate(doc.id, doc.data())
      if (tpl.deleted !== true) byId.set(tpl.id, tpl)
    }
  }

  return Array.from(byId.values())
}

export async function getUserTemplate(id: string): Promise<UserTemplateRecord | null> {
  const snap = await adminDb.collection(USER_TEMPLATES_COLLECTION).doc(id).get()
  if (!snap.exists || snap.data()?.deleted === true) return null
  return hydrateTemplate(snap.id, snap.data() as Record<string, unknown>)
}

/**
 * Returns the template only if `user` is allowed to read it. Used by the GET
 * detail route and the new-document seeding flow.
 */
export async function getAccessibleUserTemplate(
  id: string,
  user: ApiUser,
): Promise<{ ok: true; template: UserTemplateRecord } | { ok: false; error: string; status: number }> {
  const template = await getUserTemplate(id)
  if (!template) return { ok: false, error: 'Template not found', status: 404 }
  if (!canAccessUserTemplate(template, user)) return { ok: false, error: 'Forbidden', status: 403 }
  return { ok: true, template }
}

export async function softDeleteUserTemplate(
  id: string,
  user: ApiUser,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const template = await getUserTemplate(id)
  if (!template) return { ok: false, error: 'Template not found', status: 404 }
  if (!canAccessUserTemplate(template, user)) return { ok: false, error: 'Forbidden', status: 403 }

  await adminDb.collection(USER_TEMPLATES_COLLECTION).doc(id).update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { ok: true }
}

export type { DocumentBlock }
