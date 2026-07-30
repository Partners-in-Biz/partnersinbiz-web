import { apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { getClientDocument } from './store'
import type { ClientDocument, ClientDocumentStatus } from './types'

const CLIENT_VISIBLE_STATUSES = new Set<ClientDocumentStatus>([
  'client_review',
  'changes_requested',
  'approved',
  'accepted',
])

function userOrgIds(user: ApiUser): string[] {
  return user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
}

function linkedClientOrgIds(document: Partial<ClientDocument>): string[] {
  const ids = new Set<string>()
  const linked = document.linked
  if (typeof linked?.clientOrgId === 'string' && linked.clientOrgId.trim()) ids.add(linked.clientOrgId.trim())
  for (const id of linked?.clientOrgIds ?? []) {
    if (typeof id === 'string' && id.trim()) ids.add(id.trim())
  }
  return Array.from(ids)
}

function isExplicitlyLinkedClientVisible(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (user.role !== 'client') return false
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  const allowedOrgIds = new Set(userOrgIds(user))
  return linkedClientOrgIds(document).some((orgId) => allowedOrgIds.has(orgId))
}

function isInternalCollaborator(document: Partial<ClientDocument>, user: ApiUser): boolean {
  // Creator always retains access (including after agent-assisted creation under user-delegation).
  if (document.createdBy === user.uid) return true
  if ((document.sharedWithUserIds ?? []).includes(user.uid)) return true

  // External client portal accounts only get the collaborator paths above plus
  // explicit client-visible statuses (handled separately). Platform admins use
  // org-scope resolution rather than this helper.
  if (user.role !== 'client') return false

  return false
}

export function assertClientDocumentDataAccess(document: Partial<ClientDocument>, user: ApiUser) {
  if (user.role === 'client') {
    if (isInternalCollaborator(document, user)) return { ok: true as const }
    if (isExplicitlyLinkedClientVisible(document, user)) return { ok: true as const }
    return { ok: false as const, response: apiError('Forbidden', 403) }
  }

  if (!document.orgId) {
    return { ok: true as const }
  }

  const scope = resolveOrgScope(user, document.orgId)
  if (!scope.ok) return { ok: false as const, response: apiError(scope.error, scope.status) }

  return { ok: true as const }
}

export function isClientDocumentVisibleToUser(document: Partial<ClientDocument>, user: ApiUser): boolean {
  return isInternalCollaborator(document, user) || isExplicitlyLinkedClientVisible(document, user)
}

/** Internal collaborators may read a shared document; only its creator may manage it. */
export function canManageClientDocument(document: Partial<ClientDocument>, user: ApiUser): boolean {
  return user.role !== 'client' || document.createdBy === user.uid
}

export async function getAccessibleClientDocument(id: string, user: ApiUser) {
  const document = await getClientDocument(id)
  if (!document) return { ok: false as const, response: apiError('Document not found', 404) }

  const access = assertClientDocumentDataAccess(document, user)
  if (!access.ok) return access

  return { ok: true as const, document }
}

export function isClientVisibleClientDocument(document: Pick<ClientDocument, 'status'>): boolean {
  return CLIENT_VISIBLE_STATUSES.has(document.status)
}

export function isClientVisibleToOrg(document: Partial<ClientDocument>, orgId: string): boolean {
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  return linkedClientOrgIds(document).includes(orgId)
}

export function explicitLinkedClientOrgIds(document: Partial<ClientDocument>): string[] {
  return linkedClientOrgIds(document)
}
