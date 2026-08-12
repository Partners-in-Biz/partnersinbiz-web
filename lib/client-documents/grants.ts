import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { adminDb } from '@/lib/firebase/admin'

import type { ClientDocument } from './types'
import type {
  DocumentUserShare,
  DocumentUserSharePermissions,
  DocumentUserShareStatus,
  RevokeUserShareInput,
  UserShareInput,
} from './types'

export type {
  DocumentUserShare,
  DocumentUserSharePermissions,
  DocumentUserShareStatus,
  RevokeUserShareInput,
  UserShareInput,
}

/**
 * Validated named-user document shares (Phase 0 containment).
 *
 * Replaces the legacy `sharedWithUserIds` raw-array holder bypass. A named
 * user only gains access through an explicit, validated grant that carries:
 *   - active share state (`status` active|revoked|expired)
 *   - an allowed recipient relationship/org (`recipientOrgId` must be the
 *     document holder org or a currently-linked recipient client org)
 *   - expiry (`expiresAt`) and revocation (`revokedAt`/`revokedBy`)
 *   - version and attachment permission checks
 *     (`permissions.canViewVersions` / `permissions.canViewAttachments`)
 *
 * The shape is ResourceAccessGrant-compatible: it carries owner/provenance
 * (grantedBy/grantedAt), recipient org, named user, actions (permissions),
 * expiry, revocation and lifecycle state — the same fields the universal
 * ResourceAccessGrant policy service (Phase 1, spec P2) will normalise.
 *
 * `shareEnabled` / `shareToken` / `editShareToken` (public token sharing)
 * remain completely separate from these named-user grants.
 */

export const DEFAULT_USER_SHARE_PERMISSIONS: DocumentUserSharePermissions = {
  canView: true,
  canComment: false,
  canSuggest: false,
  canViewVersions: true,
  canViewAttachments: true,
  canApprove: false,
}

const USER_SHARE_PERMISSION_KEYS = new Set<keyof DocumentUserSharePermissions>([
  'canView',
  'canComment',
  'canSuggest',
  'canViewVersions',
  'canViewAttachments',
  'canApprove',
])

function userOrgIds(user: Pick<ApiUser, 'orgId' | 'orgIds'>): string[] {
  return user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recipientClientOrgIds(document: Partial<ClientDocument>): string[] {
  const ids = new Set<string>()
  const linked = document.linked
  if (typeof linked?.clientOrgId === 'string' && linked.clientOrgId.trim()) ids.add(linked.clientOrgId.trim())
  for (const id of linked?.clientOrgIds ?? []) {
    if (typeof id === 'string' && id.trim()) ids.add(id.trim())
  }
  return Array.from(ids).filter((id) => id !== PIB_PLATFORM_ORG_ID)
}

/**
 * Orgs a grant may be stamped against: the document holder org plus every
 * currently-linked recipient client org. The platform holder org is never a
 * *client* recipient — it can only appear as the holder.
 */
export function allowedRecipientOrgIds(document: Partial<ClientDocument>): string[] {
  const ids = new Set<string>()
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (holderOrgId) ids.add(holderOrgId)
  for (const orgId of recipientClientOrgIds(document)) ids.add(orgId)
  return Array.from(ids)
}

function isAllowedRecipientOrg(document: Partial<ClientDocument>, orgId: string): boolean {
  return allowedRecipientOrgIds(document).includes(orgId)
}

function userCanReachOrg(user: ApiUser, orgId: string, holderOrgId: string): boolean {
  if (orgId === holderOrgId) {
    if (user.role === 'admin' && canAccessOrg(user, orgId)) return true
    if (user.role === 'ai') return true
    return userOrgIds(user).includes(orgId)
  }
  // Client recipient orgs are reached through the user's own org memberships.
  if (orgId === PIB_PLATFORM_ORG_ID) return false
  return userOrgIds(user).includes(orgId)
}

/** Active, unexpired grant for the uid, when the recipient org is still allowed for the document. */
export function userShareGrantForUser(document: Partial<ClientDocument>, uid: string): DocumentUserShare | null {
  if (!uid) return null
  const shares = Array.isArray(document.userShares) ? document.userShares : []
  const match = shares.find((share) => share && cleanString(share.userId) === uid)
  if (!match) return null
  // Deliberately synchronous: the transaction/read access path must not depend
  // on a second DB round-trip. Recipient eligibility is validated at grant
  // time (assertRecipientShareEligible); active-membership revocation of the
  // session is handled by the P0 active-membership middleware.
  if (match.status !== 'active') return null
  if (match.expiresAt) {
    const expiry = new Date(match.expiresAt).getTime()
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null
  }
  const recipientOrgId = cleanString(match.recipientOrgId)
  if (!recipientOrgId) return null
  // The recipient relationship/org must still be allowed for the document
  // (removing the link kills the share without a revoke).
  if (!isAllowedRecipientOrg(document, recipientOrgId)) return null
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!holderOrgId) return null
  return match
}

/**
 * Canonical named-user access check used by access.ts. A user gets document
 * access through a share only when the grant is active, unexpired, stamped
 * against an org that is still an allowed recipient of the document, and the
 * user can actually reach that org.
 */
export function hasActiveUserShare(document: Partial<ClientDocument>, user: ApiUser): boolean {
  const grant = userShareGrantForUser(document, user.uid)
  if (!grant) return false
  const recipientOrgId = cleanString(grant.recipientOrgId)
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  if (!userCanReachOrg(user, recipientOrgId, holderOrgId)) return false
  return true
}

function userIsHolderStaff(document: Partial<ClientDocument>, user: ApiUser): boolean {
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

/**
 * True when a named-user share constrains this user's permissions: they hold
 * an active share AND are not the creator / holder staff. Version and
 * attachment permission gating applies to these recipients — even when they
 * would also qualify as a linked client member, an explicit canViewVersions /
 * canViewAttachments=false on their share is honoured.
 */
export function isGrantOnlyRecipient(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (!hasActiveUserShare(document, user)) return false
  return !userIsHolderStaff(document, user)
}

/** Version history permission for a named-user share. Creator / holder staff are unrestricted. */
export function canUserShareViewVersions(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (!isGrantOnlyRecipient(document, user)) return true
  const grant = userShareGrantForUser(document, user.uid)
  return grant ? grant.permissions.canViewVersions !== false : false
}

/** Attachment / export permission for a named-user share. Creator / holder staff are unrestricted. */
export function canUserShareViewAttachments(document: Partial<ClientDocument>, user: ApiUser): boolean {
  if (!isGrantOnlyRecipient(document, user)) return true
  const grant = userShareGrantForUser(document, user.uid)
  return grant ? grant.permissions.canViewAttachments !== false : false
}

/** Derived list index: active, unexpired grant recipient uids (Firestore array-contains friendly). */
export function deriveUserShareUserIds(document: Partial<ClientDocument>): string[] {
  const shares = Array.isArray(document.userShares) ? document.userShares : []
  const ids = new Set<string>()
  for (const share of shares) {
    if (!share || share.status !== 'active') continue
    if (share.expiresAt) {
      const expiry = new Date(share.expiresAt).getTime()
      if (!Number.isFinite(expiry) || expiry <= Date.now()) continue
    }
    const uid = cleanString(share.userId)
    if (uid) ids.add(uid)
  }
  return Array.from(ids)
}

function validatePermissions(value: unknown): { ok: true; value: Partial<DocumentUserSharePermissions> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'permissions must be an object' }
  }
  const permissions: Partial<DocumentUserSharePermissions> = {}
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!USER_SHARE_PERMISSION_KEYS.has(key as keyof DocumentUserSharePermissions)) {
      return { ok: false, error: `permissions contains unsupported key: ${key}` }
    }
    if (typeof flag !== 'boolean') {
      return { ok: false, error: `permissions.${key} must be a boolean` }
    }
    permissions[key as keyof DocumentUserSharePermissions] = flag
  }
  return { ok: true, value: permissions }
}

function validateEntry(value: unknown): { ok: true; value: UserShareInput } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'each user share must be an object' }
  }
  const row = value as Record<string, unknown>
  const allowedFields = new Set(['userId', 'recipientOrgId', 'expiresAt', 'permissions'])
  const unknownFields = Object.keys(row).filter((field) => !allowedFields.has(field))
  if (unknownFields.length > 0) {
    return { ok: false, error: `user share contains unsupported field(s): ${unknownFields.join(', ')}` }
  }
  const userId = cleanString(row.userId)
  if (!userId) return { ok: false, error: 'userShares[].userId must be a non-empty string' }
  if (userId.length > 256) return { ok: false, error: 'userShares[].userId is too long' }
  const recipientOrgId = cleanString(row.recipientOrgId)
  if (!recipientOrgId) return { ok: false, error: 'userShares[].recipientOrgId must be a non-empty string' }
  if (recipientOrgId.length > 256) return { ok: false, error: 'userShares[].recipientOrgId is too long' }
  let expiresAt: string | undefined
  if (row.expiresAt !== undefined) {
    if (typeof row.expiresAt !== 'string') return { ok: false, error: 'userShares[].expiresAt must be an ISO date string' }
    const parsed = new Date(row.expiresAt).getTime()
    if (!Number.isFinite(parsed)) return { ok: false, error: 'userShares[].expiresAt must be a valid ISO date string' }
    if (parsed <= Date.now()) return { ok: false, error: 'userShares[].expiresAt must be in the future' }
    expiresAt = row.expiresAt
  }
  const permissions = validatePermissions(row.permissions)
  if (!permissions.ok) return permissions
  return { ok: true, value: { userId, recipientOrgId, ...(expiresAt ? { expiresAt } : {}), ...(row.permissions !== undefined ? { permissions: permissions.value } : {}) } }
}

/** Parse the `userShares` PATCH body. */
export function validateUserShareInput(value: unknown): { ok: true; value: UserShareInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'userShares must be an array' }
  if (value.length > 100) return { ok: false, error: 'userShares must contain at most 100 entries' }
  const entries: UserShareInput[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = validateEntry(value[index])
    if (!entry.ok) return entry
    entries.push(entry.value)
  }
  return { ok: true, value: entries }
}

function validateRevokeEntry(value: unknown): { ok: true; value: RevokeUserShareInput } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'each revoke entry must be an object' }
  }
  const row = value as Record<string, unknown>
  const userId = cleanString(row.userId)
  const recipientOrgId = cleanString(row.recipientOrgId)
  if (!userId || !recipientOrgId) {
    return { ok: false, error: 'revokeUserShares[] requires userId and recipientOrgId' }
  }
  return { ok: true, value: { userId, recipientOrgId } }
}

/** Parse the `revokeUserShares` PATCH body. */
export function validateRevokeUserShareInput(value: unknown): { ok: true; value: RevokeUserShareInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'revokeUserShares must be an array' }
  const entries: RevokeUserShareInput[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = validateRevokeEntry(value[index])
    if (!entry.ok) return entry
    entries.push(entry.value)
  }
  return { ok: true, value: entries }
}

/**
 * Async eligibility check at grant time. The recipient must be an active
 * member of the granted org (orgMembers row), or platform staff (users doc
 * role admin/ai) when the grant is against the holder org. This is the
 * "validated" half of the share — access re-checks the contract fields.
 */
export async function assertRecipientShareEligible(
  document: Partial<ClientDocument>,
  input: UserShareInput,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const recipientOrgId = cleanString(input.recipientOrgId)
  if (!isAllowedRecipientOrg(document, recipientOrgId)) {
    return { ok: false, error: `${recipientOrgId} is not an allowed recipient org for this document`, status: 400 }
  }
  const holderOrgId = typeof document.orgId === 'string' ? document.orgId.trim() : ''
  const isHolderGrant = Boolean(holderOrgId && recipientOrgId === holderOrgId)

  const memberSnap = await adminDb.collection('orgMembers').doc(`${recipientOrgId}_${input.userId}`).get()
  if (memberSnap.exists) {
    const memberData = memberSnap.data() ?? {}
    if (isActiveOrgMembershipRow(memberData)) return { ok: true }
  }

  // Platform staff (admin/AI) may hold a share against the holder org without
  // an orgMembers row. Never for a client recipient org.
  if (isHolderGrant) {
    const userSnap = await adminDb.collection('users').doc(input.userId).get()
    if (userSnap.exists) {
      const userData = userSnap.data() ?? {}
      const role = typeof userData.role === 'string' ? userData.role : ''
      if (role === 'admin' || role === 'ai') return { ok: true }
    }
  }

  return { ok: false, error: `${input.userId} is not an active member of ${recipientOrgId}`, status: 400 }
}

function mergePermissions(base: DocumentUserSharePermissions, partial: Partial<DocumentUserSharePermissions> | undefined): DocumentUserSharePermissions {
  return { ...base, ...(partial ?? {}) }
}

/** Upsert validated share inputs onto existing grants, stamping provenance and lifecycle. */
export function upsertUserShares(
  existing: DocumentUserShare[] | undefined,
  inputs: UserShareInput[],
  actor: { uid: string },
): { shares: DocumentUserShare[]; userShareUserIds: string[] } {
  const shares = Array.isArray(existing) ? existing.map((share) => ({ ...share, permissions: { ...share.permissions } })) : []
  const now = new Date().toISOString()
  for (const input of inputs) {
    const recipientOrgId = cleanString(input.recipientOrgId)
    const index = shares.findIndex((share) => cleanString(share.userId) === input.userId && cleanString(share.recipientOrgId) === recipientOrgId)
    const stamped: DocumentUserShare = {
      userId: input.userId,
      recipientOrgId,
      status: 'active',
      grantedBy: actor.uid,
      grantedAt: now,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      permissions: mergePermissions(DEFAULT_USER_SHARE_PERMISSIONS, input.permissions),
    }
    if (index >= 0) {
      const prior = shares[index]
      shares[index] = {
        ...stamped,
        grantedAt: prior.grantedAt,
        ...(prior.grantedBy ? { grantedBy: prior.grantedBy } : {}),
      }
      delete shares[index].revokedAt
      delete shares[index].revokedBy
    } else {
      shares.push(stamped)
    }
  }
  return { shares, userShareUserIds: deriveUserShareUserIds({ userShares: shares }) }
}

/** Revoke shares with audit fields; access and the derived index fail closed. */
export function revokeUserShares(
  existing: DocumentUserShare[] | undefined,
  revokes: RevokeUserShareInput[],
  actor: { uid: string },
): { shares: DocumentUserShare[]; userShareUserIds: string[] } {
  const shares = Array.isArray(existing) ? existing.map((share) => ({ ...share })) : []
  const now = new Date().toISOString()
  for (const revoke of revokes) {
    const recipientOrgId = cleanString(revoke.recipientOrgId)
    const index = shares.findIndex((share) => cleanString(share.userId) === revoke.userId && cleanString(share.recipientOrgId) === recipientOrgId)
    if (index < 0) continue
    shares[index] = {
      ...shares[index],
      status: 'revoked',
      revokedAt: now,
      revokedBy: actor.uid,
    }
  }
  return { shares, userShareUserIds: deriveUserShareUserIds({ userShares: shares }) }
}
