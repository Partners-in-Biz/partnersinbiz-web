import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import type { ApiUser } from '@/lib/api/types'
import type { BookStudioResourceKey } from './types'
import { BOOK_STUDIO_RESOURCES } from './sanitize'

const REFERENCE_COLLECTIONS: Array<[string, string]> = [
  ['projectId', 'book_studio_projects'],
  ['seriesId', 'book_studio_series'],
  ['briefId', 'book_studio_briefs'],
  ['packetId', 'book_studio_publishing_packets'],
]

function agentPermissionAllows(user: ApiUser, orgId: string, action: 'read' | 'write') {
  if (user.authKind !== 'agent_api_key') return true
  if (user.orgId) return user.orgId === orgId
  if (!user.permissions?.length) return false
  return user.permissions.some((permission) => {
    const resource = permission.resource.trim().toLowerCase()
    const actions = permission.actions.map((item) => item.trim().toLowerCase())
    return [`book-studio:${orgId}`, `org:${orgId}:book-studio`].includes(resource)
      && (actions.includes(action) || actions.includes('*'))
  })
}

export function actorFields(user: ApiUser) {
  const actorType = user.role === 'ai' ? 'agent' : 'user'
  return {
    createdBy: user.uid,
    createdByType: actorType,
    updatedBy: user.uid,
    updatedByType: actorType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function updateActorFields(user: ApiUser) {
  return {
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function orgIdFromRequest(req: Request, body?: Record<string, unknown>) {
  const url = new URL(req.url)
  const headerOrgId = req.headers.get('x-org-id')?.trim()
  const queryOrgId = url.searchParams.get('orgId')?.trim()
  const bodyOrgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  const orgIds = [headerOrgId, queryOrgId, bodyOrgId].filter((value): value is string => Boolean(value))
  const unique = Array.from(new Set(orgIds))
  return {
    orgId: unique[0] ?? '',
    mismatch: unique.length > 1,
  }
}

export async function ensureBookStudioAccess(req: Request, user: ApiUser, body?: Record<string, unknown>, action: 'read' | 'write' = 'read') {
  const { orgId, mismatch } = orgIdFromRequest(req, body)
  if (!orgId) return { error: apiError('orgId is required', 400), orgId: '' }
  if (mismatch) return { error: apiError('orgId mismatch between header, query, and body', 400), orgId }
  if (!canAccessOrg(user, orgId)) return { error: apiError('Forbidden', 403), orgId }
  if (!agentPermissionAllows(user, orgId, action)) return { error: apiError('Forbidden', 403), orgId }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return { error: apiError('Organisation not found', 404), orgId }
  const settings = orgDoc.data()?.settings
  if (!isPortalModuleEnabled(settings, 'bookStudio')) {
    return {
      error: apiError('Book Studio module is disabled for this organisation', 403, {
        moduleDisabled: true,
        module: 'bookStudio',
      }),
      orgId,
    }
  }

  return { orgId }
}

export function collectionFor(resource: BookStudioResourceKey) {
  return BOOK_STUDIO_RESOURCES[resource].collection
}

export async function validateBookStudioReferences(orgId: string, data: Record<string, unknown>) {
  for (const [field, collectionName] of REFERENCE_COLLECTIONS) {
    const id = typeof data[field] === 'string' ? data[field].trim() : ''
    if (!id) continue

    const snap = await adminDb.collection(collectionName).doc(id).get()
    if (!snap.exists) return apiError(`${field} was not found`, 404)
    const refData = snap.data() ?? {}
    if (refData.orgId !== orgId || refData.deleted === true) return apiError('Referenced Book Studio record belongs to another organisation', 403)
  }

  return null
}
