import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { hasActiveOrgMembership } from '@/lib/orgMembers/active-membership'
import { FirestoreCrossOrgPolicyStore, CrossOrgPolicyService } from '@/lib/cross-org/policy-service'
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
import { findDocumentPartnerLinkId } from './canonical-grants'
import type { ClientDocument } from './types'

const CLIENT_VISIBLE_STATUSES = DOCUMENT_CLIENT_FACING_STATUSES
const crossOrgPolicyService = new CrossOrgPolicyService(new FirestoreCrossOrgPolicyStore())

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

function documentItemForAction(document: Partial<ClientDocument>, action: ClientDocumentAction, explicitItem?: string): string | undefined {
  if (explicitItem) return explicitItem
  if (action === 'read') {
    return typeof document.latestPublishedVersionId === 'string' && document.latestPublishedVersionId.trim()
      ? document.latestPublishedVersionId.trim()
      : typeof document.currentVersionId === 'string' && document.currentVersionId.trim()
        ? document.currentVersionId.trim()
        : undefined
  }
  if (action === 'approve' || action === 'accept' || action === 'sign') {
    return typeof document.latestPublishedVersionId === 'string' && document.latestPublishedVersionId.trim()
      ? document.latestPublishedVersionId.trim()
      : undefined
  }
  return undefined
}

function policyActionFor(action: ClientDocumentAction): string {
  switch (action) {
    case 'versions':
      return 'document.version.read'
    case 'attachments':
      return 'document.download'
    case 'comment':
      return 'document.comment'
    case 'suggest':
      return 'document.suggest'
    case 'approve':
      return 'document.approve'
    case 'accept':
      return 'document.accept'
    case 'sign':
      return 'document.sign'
    case 'write':
      return 'document.write'
    case 'read':
    default:
      return 'document.read'
  }
}

function recipientClientOrgIds(document: Partial<ClientDocument>): string[] {
  return linkedClientOrgIds(document).filter((orgId) => orgId !== PIB_PLATFORM_ORG_ID)
}

function isExplicitlyLinkedClientVisible(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (user.role !== 'client') return false
  if (!document.status || !CLIENT_VISIBLE_STATUSES.has(document.status)) return false
  const allowedOrgIds = new Set(userOrgIds(user).filter((orgId) => orgId !== PIB_PLATFORM_ORG_ID))
  if (allowedOrgIds.size === 0) return false
  return recipientClientOrgIds(document).some((orgId) => allowedOrgIds.has(orgId))
}

function isHolderTeamMember(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (document.createdBy === user.uid) return true

  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!holderOrgId) return false

  if (user.role === 'client') {
    if (holderOrgId === PIB_PLATFORM_ORG_ID) return false
    return userOrgIds(user).includes(holderOrgId)
  }

  if (userOrgIds(user).includes(holderOrgId)) return true
  if (user.role === 'admin' && canAccessOrg(user, holderOrgId)) return true

  return false
}

function isInternalCollaborator(document: Partial<ClientDocument>, user: ApiUser): boolean {
  // Named-user shares are authenticated partner grants, not holder-team authority.
  // Keep them out of the holder path so manage/delete paths cannot treat a share as staff.
  return isHolderTeamMember(document, user)
}

async function isTrustedInternalCollaborator(document: Partial<ClientDocument>, user: ApiUser): Promise<boolean> {
  if (document.createdBy === user.uid) return true
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!holderOrgId) return false
  if (user.role === 'client') {
    if (holderOrgId === PIB_PLATFORM_ORG_ID) return false
    return hasActiveOrgMembership(holderOrgId, user.uid)
  }
  if (userOrgIds(user).includes(holderOrgId)) return true
  return user.role === 'admin' && canAccessOrg(user, holderOrgId)
}

async function externalRecipientOrgCandidates(document: Partial<ClientDocument>, user: ApiUser): Promise<string[]> {
  if (user.role !== 'client') return []
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  const requested = new Set<string>()
  const share = userShareGrantForUser(document, user.uid)
  const shareRecipientOrgId = typeof share?.recipientOrgId === 'string' ? share.recipientOrgId.trim() : ''
  if (shareRecipientOrgId && shareRecipientOrgId !== holderOrgId) requested.add(shareRecipientOrgId)
  for (const orgId of recipientClientOrgIds(document)) {
    if (userOrgIds(user).includes(orgId)) requested.add(orgId)
  }
  const active: string[] = []
  for (const orgId of Array.from(requested)) {
    if (await hasActiveOrgMembership(orgId, user.uid)) active.push(orgId)
  }
  return active
}

async function hasCanonicalPartnerGrant(
  document: ClientDocument,
  user: ApiUser,
  action: ClientDocumentAction,
  item?: string,
): Promise<boolean> {
  const ownerOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!ownerOrgId || user.role !== 'client') return false
  const recipientOrgIds = await externalRecipientOrgCandidates(document, user)
  if (recipientOrgIds.length === 0) return false
  const requireNamedUser = Boolean(userShareGrantForUser(document, user.uid))
  const policyAction = policyActionFor(action)
  const decisionItem = documentItemForAction(document, action, item)

  for (const recipientOrgId of recipientOrgIds) {
    const partnerLinkId = await findDocumentPartnerLinkId(ownerOrgId, recipientOrgId)
    if (!partnerLinkId) continue
    const decision = await crossOrgPolicyService.decide({
      actor: { userId: user.uid, orgId: recipientOrgId },
      resourceType: 'document',
      resourceId: document.id,
      resourceOwnerOrgId: ownerOrgId,
      action: policyAction,
      ...(decisionItem ? { item: decisionItem } : {}),
      partnerLinkId,
      requiredCapability: 'documents',
      requireNamedUser,
      recordDecision: false,
    })
    if (decision.allowed) return true
  }

  return false
}

export function assertClientDocumentDataAccess(document: Partial<ClientDocument>, user: ApiUser) {
  if (user.role === 'client') {
    if (isInternalCollaborator(document, user)) return { ok: true as const }
    if (hasActiveUserShare(document, user)) return { ok: true as const }
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
  return (
    isInternalCollaborator(document, user)
    || hasActiveUserShare(document, user)
    || isExplicitlyLinkedClientVisible(document, user)
  )
}

export { isDocumentClientFacingStatus }

export function canManageClientDocument(document: Partial<ClientDocument>, user: ApiUser): boolean {
  return user.role !== 'client' || document.createdBy === user.uid
}

export type ClientDocumentAction = 'read' | 'versions' | 'attachments' | 'comment' | 'suggest' | 'approve' | 'accept' | 'sign' | 'write'

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

export async function getAccessibleClientDocument(
  id: string,
  user: ApiUser,
  action: ClientDocumentAction = 'read',
  options: { item?: string } = {},
) {
  const document = await getClientDocument(id)
  if (!document) return { ok: false as const, response: apiError('Document not found', 404) }

  if (await isTrustedInternalCollaborator(document, user)) {
    return { ok: true as const, document }
  }

  // Clients use the same list-equivalent gate as staff: linked client-visible
  // docs and active named shares. Partner-link grants are a fallback only.
  // Public share tokens are never consulted on this authenticated path.
  const access = assertClientDocumentActionAccess(document, user, action)
  if (access.ok) {
    return { ok: true as const, document }
  }

  if (await hasCanonicalPartnerGrant(document, user, action, options.item)) {
    return { ok: true as const, document }
  }

  return { ok: false as const, response: access.response }
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
