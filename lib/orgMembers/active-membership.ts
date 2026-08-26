// lib/orgMembers/active-membership.ts
//
// Central active-membership predicate for Partners in Biz.
//
// Every portal and CRM middleware path that decides whether a user may act in
// an organisation MUST go through these helpers so that disabled, revoked,
// deleted and inactive membership rows are rejected consistently. Convenience
// pointers on the user record (orgId / orgIds / activeOrgId) never grant
// access on their own; the orgMembers row (or the legacy organizations.members
// array entry) must be present and active.

import { adminDb } from '@/lib/firebase/admin'
import type { OrgRole } from '@/lib/organizations/types'
import { ROLE_RANK } from '@/lib/orgMembers/types'

export type OrgMemberRow = Record<string, unknown>

export interface ActiveOrgMember {
  orgId: string
  uid: string
  role: OrgRole
  row: OrgMemberRow
}

/**
 * True when an orgMembers row (or a legacy organizations.members array entry)
 * represents an ACTIVE membership. Rejects rows that are:
 *   - explicitly disabled (disabled === true / status 'disabled')
 *   - revoked (revoked === true / revokedAt / status 'revoked')
 *   - deleted (deleted === true / deletedAt / status 'deleted' / 'removed')
 *   - inactive (inactive === true / status 'inactive' / 'suspended' / 'left' / 'churned')
 *
 * Missing status is treated as active (legacy rows predate the status field).
 * Anything else is treated as active only when the status string is an
 * explicitly active value.
 * 
 * EXCEPTION: Org owners can access their orgs regardless of status, as long as
 * the row doesn't have an explicit negative flag (disabled/revoked/deleted/inactive/archived)
 * or an explicit negative status string. This allows platform team members to
 * switch between their owned orgs even during setup/configuration/onboarding.
 */
export function isActiveOrgMembershipRow(row: OrgMemberRow | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false
  if (row.disabled === true) return false
  if (row.deleted === true || row.deletedAt) return false
  if (row.revoked === true || row.revokedAt) return false
  if (row.inactive === true) return false
  if (row.archived === true) return false

  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
  const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : ''
  
  // Explicit negative status strings always block access, even for owners.
  const negativeStatuses = ['disabled', 'revoked', 'deleted', 'removed', 'inactive', 'suspended', 'left', 'churned']
  if (negativeStatuses.includes(status)) return false
  
  // Owners can access their orgs with any non-negative status (including pending,
  // onboarding, setup, draft, configuring, etc.) This ensures they can use the
  // workspace switcher even when org setup is incomplete.
  if (role === 'owner') return true
  
  // Non-owners require explicit active status or missing status.
  if (status === '') return true
  if (['active', 'enabled'].includes(status)) return true
  
  return false
}

/** Validate a candidate role against the canonical OrgRole set. */
export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ROLE_RANK
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Load the active orgMembers row for (orgId, uid). Returns null when the row
 * is missing, deleted, revoked, disabled or otherwise inactive.
 */
export async function loadActiveOrgMember(orgId: string, uid: string): Promise<ActiveOrgMember | null> {
  const cleanOrgId = cleanString(orgId)
  const cleanUid = cleanString(uid)
  if (!cleanOrgId || !cleanUid) return null

  const doc = await adminDb.collection('orgMembers').doc(`${cleanOrgId}_${cleanUid}`).get()
  if (!doc.exists) return null
  const row = doc.data() ?? {}
  if (!isActiveOrgMembershipRow(row)) return null
  const role = row.role
  if (!isOrgRole(role)) return null
  return { orgId: cleanOrgId, uid: cleanUid, role, row }
}

/**
 * True when the user has an active membership row for the org — either the
 * canonical orgMembers row or the legacy organizations.members array entry.
 * Role validity is not required here: portal org switching only needs to know
 * the membership is live; role-gated routes resolve the role separately.
 */
export async function hasActiveOrgMembership(orgId: string, uid: string): Promise<boolean> {
  const cleanOrgId = cleanString(orgId)
  const cleanUid = cleanString(uid)
  if (!cleanOrgId || !cleanUid) return false

  const doc = await adminDb.collection('orgMembers').doc(`${cleanOrgId}_${cleanUid}`).get()
  if (doc.exists && isActiveOrgMembershipRow(doc.data() ?? {})) return true

  const orgDoc = await adminDb.collection('organizations').doc(cleanOrgId).get()
  if (!orgDoc.exists) return false
  const orgData = orgDoc.data() ?? {}
  if (orgData.deleted === true || orgData.archived === true || orgData.status === 'suspended' || orgData.status === 'churned') {
    return false
  }
  const members = Array.isArray(orgData.members) ? orgData.members : []
  return members.some((member) => memberEntryMatchesUid(member, cleanUid))
}

async function queryActiveMemberOrgIds(field: 'uid' | 'userId', uid: string): Promise<string[]> {
  try {
    const snap = await adminDb.collection('orgMembers').where(field, '==', uid).get()
    const ids = new Set<string>()
    for (const doc of snap.docs) {
      const row = doc.data() ?? {}
      if (!isActiveOrgMembershipRow(row)) continue
      const orgId = cleanString(row.orgId) || orgIdFromMemberDocId(doc.id, uid)
      if (orgId) ids.add(orgId)
    }
    return Array.from(ids)
  } catch (err) {
    console.error(`[orgMembers] ${field} membership query failed`, err)
    return []
  }
}

/**
 * All org ids where the user holds an ACTIVE orgMembers row.
 * Filtered by the canonical predicate — revoked/disabled/deleted rows never
 * surface here.
 *
 * Query both `uid` and `userId`: older rows and some write paths stored the
 * Firebase uid under `userId` only. A uid-only query made those memberships
 * invisible to the portal workspace switcher even though document-id lookups
 * still granted access.
 */
export async function activeOrgMembershipOrgIds(uid: string): Promise<string[]> {
  const cleanUid = cleanString(uid)
  if (!cleanUid) return []
  const [uidOrgIds, userIdOrgIds] = await Promise.all([
    queryActiveMemberOrgIds('uid', cleanUid),
    queryActiveMemberOrgIds('userId', cleanUid),
  ])
  return Array.from(new Set([...uidOrgIds, ...userIdOrgIds]))
}

function memberEntryMatchesUid(member: unknown, uid: string): boolean {
  if (!member || typeof member !== 'object') return false
  const entry = member as OrgMemberRow
  const entryUid = cleanString(entry.userId) || cleanString(entry.uid)
  return entryUid === uid && isActiveOrgMembershipRow(entry)
}

/**
 * Every org whose embedded organizations.members array lists this uid as an
 * active member. Used by the portal switcher so Org.members-only owners
 * (missing orgMembers / users.orgIds / accessScope) still appear.
 * Does not special-case slugs and does not invent memberships.
 */
export async function organizationEmbeddedMemberOrgIds(uid: string): Promise<string[]> {
  const cleanUid = cleanString(uid)
  if (!cleanUid) return []
  try {
    const collection = adminDb.collection('organizations') as { get?: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> }
    if (typeof collection.get !== 'function') return []
    const snap = await collection.get()
    const ids: string[] = []
    for (const doc of snap.docs) {
      const orgData = doc.data() ?? {}
      if (orgData.deleted === true || orgData.archived === true) continue
      const status = typeof orgData.status === 'string' ? orgData.status.trim().toLowerCase() : ''
      if (status === 'suspended' || status === 'churned') continue
      const members = Array.isArray(orgData.members) ? orgData.members : []
      if (members.some((member) => memberEntryMatchesUid(member, cleanUid))) {
        ids.push(doc.id)
      }
    }
    return ids
  } catch (err) {
    console.error('[organizations] embedded members scan failed', err)
    return []
  }
}

/**
 * Legacy orgs where the user appears as an ACTIVE entry in the
 * organizations.members array (rows created before orgMembers was canonical).
 * Expensive — prefer activeOrgMembershipOrgIds where the collection exists.
 */
export async function legacyActiveOrgMembershipOrgIds(uid: string, candidateOrgIds: string[]): Promise<string[]> {
  const cleanUid = cleanString(uid)
  if (!cleanUid || candidateOrgIds.length === 0) return []
  const out: string[] = []
  for (const rawOrgId of candidateOrgIds) {
    const orgId = cleanString(rawOrgId)
    if (!orgId) continue
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) continue
    const orgData = orgDoc.data() ?? {}
    if (orgData.deleted === true || orgData.archived === true || orgData.status === 'suspended' || orgData.status === 'churned') {
      continue
    }
    const members = Array.isArray(orgData.members) ? orgData.members : []
    const active = members.some((member) => {
      if (!member || typeof member !== 'object') return false
      const entry = member as OrgMemberRow
      const entryUid = cleanString(entry.userId) || cleanString(entry.uid)
      return entryUid === cleanUid && isActiveOrgMembershipRow(entry)
    })
    if (active) out.push(orgId)
  }
  return out
}

function orgIdFromMemberDocId(docId: string, uid: string): string {
  const suffix = `_${uid}`
  return docId.endsWith(suffix) ? docId.slice(0, -suffix.length) : ''
}

/** Convenience: only valid roles may be returned; null otherwise. */
export function activeRoleOf(row: OrgMemberRow | null | undefined): OrgRole | null {
  if (!row || !isActiveOrgMembershipRow(row)) return null
  return isOrgRole(row.role) ? row.role : null
}

export { cleanString, cleanStringArray }
