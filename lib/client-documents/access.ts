import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { DOCUMENT_CLIENT_FACING_STATUSES, isDocumentClientFacingStatus } from './holder'
import { getClientDocument } from './store'
import type { ClientDocument, ClientDocumentStatus } from './types'

const CLIENT_VISIBLE_STATUSES = DOCUMENT_CLIENT_FACING_STATUSES

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

/** Recipient org may see only after we move past internal draft/review. */
function isExplicitlyLinkedClientVisible(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (user.role !== 'client') return false
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  const allowedOrgIds = new Set(userOrgIds(user))
  return linkedClientOrgIds(document).some((orgId) => allowedOrgIds.has(orgId))
}

/**
 * Holder-team access: creator, explicit share, or member of the document holder org.
 * Holder org members see internal drafts; external clients only get client-facing via link.
 */
function isHolderTeamMember(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (document.createdBy === user.uid) return true
  if ((document.sharedWithUserIds ?? []).includes(user.uid)) return true

  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!holderOrgId) return false

  // Member of the holder workspace (e.g. pib-platform-owner). External client
  // orgs are not on this list for PiB-held docs — they only get client-facing.
  if (userOrgIds(user).includes(holderOrgId)) return true
  if (user.role === 'admin' && canAccessOrg(user, holderOrgId)) return true

  return false
}

function isInternalCollaborator(document: Partial<ClientDocument>, user: ApiUser): boolean {
  return isHolderTeamMember(document, user)
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

export { isDocumentClientFacingStatus }

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
