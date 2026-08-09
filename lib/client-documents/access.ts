import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { DOCUMENT_CLIENT_FACING_STATUSES, isDocumentClientFacingStatus } from './holder'
import { getClientDocument } from './store'
import {
  canUserShareViewAttachments,
  canUserShareViewVersions,
  hasActiveUserShare,
  isGrantOnlyRecipient,
  userShareGrantForUser,
} from './grants'
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

/** Recipient client orgs — never the platform holder stamp. */
function recipientClientOrgIds(document: Partial<ClientDocument>): string[] {
  return linkedClientOrgIds(document).filter((orgId) => orgId !== PIB_PLATFORM_ORG_ID)
}

/** Recipient org may see only after we move past internal draft/review. */
function isExplicitlyLinkedClientVisible(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (user.role !== 'client') return false
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  // Client users who also belong to the platform must still only match *real*
  // client orgs — never pib-platform-owner as a fake recipient.
  const allowedOrgIds = new Set(userOrgIds(user).filter((orgId) => orgId !== PIB_PLATFORM_ORG_ID))
  if (allowedOrgIds.size === 0) return false
  return recipientClientOrgIds(document).some((orgId) => allowedOrgIds.has(orgId))
}

/**
 * Holder-team access: creator, explicit share, or *staff* of the document holder org.
 *
 * Client-role users are never treated as holder staff — even if they are also
 * members of pib-platform-owner (Stean saw every PiB-held proposal because
 * role=client + orgIds includes the platform holder). Clients only get:
 *   - docs they created
 *   - docs shared with their uid
 *   - client-facing docs explicitly linked to their client org (recipient)
 */
function isHolderTeamMember(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (document.createdBy === user.uid) return true
  if (hasActiveUserShare(document, user)) return true

  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!holderOrgId) return false

  // Client-role users may only treat a *client* workspace as their holder home.
  // Membership of pib-platform-owner must never unlock every PiB-held proposal.
  if (user.role === 'client') {
    if (holderOrgId === PIB_PLATFORM_ORG_ID) return false
    return userOrgIds(user).includes(holderOrgId)
  }

  // Admin/AI staff of the holder workspace.
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

export type ClientDocumentAction = 'read' | 'versions' | 'attachments' | 'comment' | 'suggest' | 'approve' | 'accept'

function hasActionPermission(document: Partial<ClientDocument>, user: ApiUser, action: ClientDocumentAction): boolean {
  if (!isGrantOnlyRecipient(document, user)) return true
  const permissions = userShareGrantForUser(document, user.uid)?.permissions
  if (!permissions || permissions.canView === false) return false
  if (action === 'versions') return canUserShareViewVersions(document, user)
  if (action === 'attachments') return canUserShareViewAttachments(document, user)
  if (action === 'comment') return permissions.canComment === true
  if (action === 'suggest') return permissions.canSuggest === true
  if (action === 'approve' || action === 'accept') return permissions.canApprove === true
  return true
}

export function assertClientDocumentActionAccess(document: Partial<ClientDocument>, user: ApiUser, action: ClientDocumentAction = 'read') {
  const access = assertClientDocumentDataAccess(document, user)
  if (!access.ok) return access
  if (!hasActionPermission(document, user, action)) {
    return { ok: false as const, response: apiError('Document grant does not permit this action', 403) }
  }
  return { ok: true as const }
}

export async function getAccessibleClientDocument(id: string, user: ApiUser, action: ClientDocumentAction = 'read') {
  const document = await getClientDocument(id)
  if (!document) return { ok: false as const, response: apiError('Document not found', 404) }

  const access = assertClientDocumentActionAccess(document, user, action)
  if (!access.ok) return access

  return { ok: true as const, document }
}

export function isClientVisibleClientDocument(document: Pick<ClientDocument, 'status'>): boolean {
  return CLIENT_VISIBLE_STATUSES.has(document.status)
}

export function isClientVisibleToOrg(document: Partial<ClientDocument>, orgId: string): boolean {
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  if (orgId === PIB_PLATFORM_ORG_ID) return false
  return recipientClientOrgIds(document).includes(orgId)
}

export function explicitLinkedClientOrgIds(document: Partial<ClientDocument>): string[] {
  return recipientClientOrgIds(document)
}
