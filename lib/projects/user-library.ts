import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@/lib/firebase/admin'

export const PROJECT_USER_LIBRARY_COLLECTION = 'project_user_library'

export interface ProjectUserLibraryLink {
  linkId: string
  orgId: string
  userId: string
  projectId: string
  companyId: string | null
  active: boolean
  addedAt: unknown
  updatedAt: unknown
  removedAt: unknown | null
}

export interface ProjectUserLibraryRepository {
  get(id: string): Promise<ProjectUserLibraryLink | null>
  list(orgId: string, userId: string): Promise<ProjectUserLibraryLink[]>
  set(id: string, row: ProjectUserLibraryLink): Promise<void>
}

class FirestoreProjectUserLibraryRepository implements ProjectUserLibraryRepository {
  async get(id: string): Promise<ProjectUserLibraryLink | null> {
    const snapshot = await adminDb.collection(PROJECT_USER_LIBRARY_COLLECTION).doc(id).get()
    return snapshot.exists ? snapshot.data() as ProjectUserLibraryLink : null
  }

  async list(orgId: string, userId: string): Promise<ProjectUserLibraryLink[]> {
    const snapshot = await adminDb.collection(PROJECT_USER_LIBRARY_COLLECTION)
      .where('orgId', '==', orgId)
      .where('userId', '==', userId)
      .get()
    return snapshot.docs.map((doc) => doc.data() as ProjectUserLibraryLink)
  }

  async set(id: string, row: ProjectUserLibraryLink): Promise<void> {
    await adminDb.collection(PROJECT_USER_LIBRARY_COLLECTION).doc(id).set(row)
  }
}

interface LibraryOptions {
  repository?: ProjectUserLibraryRepository
  now?: () => unknown
}

export function projectUserLibraryLinkId(input: { orgId: string; userId: string; projectId: string }): string {
  const identity = [input.orgId.trim(), input.userId.trim(), input.projectId.trim()]
  return `project_library_${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
}

function required(value: string, field: string): string {
  const cleaned = value.trim()
  if (!cleaned) throw new Error(`${field} is required`)
  return cleaned
}

function repository(options: LibraryOptions): ProjectUserLibraryRepository {
  return options.repository ?? new FirestoreProjectUserLibraryRepository()
}

export async function listUserLibraryProjectIds(
  orgId: string,
  userId: string,
  options: LibraryOptions = {},
): Promise<string[]> {
  const rows = await repository(options).list(required(orgId, 'orgId'), required(userId, 'userId'))
  return Array.from(new Set(rows
    .filter((row) => row.active === true && row.orgId === orgId && row.userId === userId)
    .map((row) => row.projectId)
    .filter(Boolean)))
    .sort()
}

export async function addProjectToUserLibrary(
  input: { orgId: string; userId: string; projectId: string; companyId?: string | null },
  options: LibraryOptions = {},
): Promise<ProjectUserLibraryLink> {
  const identity = {
    orgId: required(input.orgId, 'orgId'),
    userId: required(input.userId, 'userId'),
    projectId: required(input.projectId, 'projectId'),
  }
  const linkId = projectUserLibraryLinkId(identity)
  const store = repository(options)
  const existing = await store.get(linkId)
  const now = options.now?.() ?? FieldValue.serverTimestamp()
  const row: ProjectUserLibraryLink = {
    linkId,
    ...identity,
    companyId: input.companyId?.trim() || existing?.companyId || null,
    active: true,
    addedAt: now,
    updatedAt: now,
    removedAt: null,
  }
  await store.set(linkId, row)
  return row
}

export async function removeProjectFromUserLibrary(
  input: { orgId: string; userId: string; projectId: string; companyId?: string | null },
  options: LibraryOptions = {},
): Promise<ProjectUserLibraryLink> {
  const identity = {
    orgId: required(input.orgId, 'orgId'),
    userId: required(input.userId, 'userId'),
    projectId: required(input.projectId, 'projectId'),
  }
  const linkId = projectUserLibraryLinkId(identity)
  const store = repository(options)
  const existing = await store.get(linkId)
  const now = options.now?.() ?? FieldValue.serverTimestamp()
  const row: ProjectUserLibraryLink = {
    linkId,
    ...identity,
    companyId: input.companyId?.trim() || existing?.companyId || null,
    active: false,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    removedAt: now,
  }
  await store.set(linkId, row)
  return row
}
