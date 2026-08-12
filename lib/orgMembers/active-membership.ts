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
 */
export function isActiveOrgMembershipRow(row: OrgMemberRow | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false
  if (row.disabled === true) return false
  if (row.deleted === true || row.deletedAt) return false
  if (row.revoked === true || row.revokedAt) return false
  if (row.inactive === true) return false
  if (row.archived === true) return false

  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
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
  return members.some((member) => {
    if (!member || typeof member !== 'object') return false
    const entry = member as OrgMemberRow
    const entryUid = cleanString(entry.userId) || cleanString(entry.uid)
    return entryUid === cleanUid && isActiveOrgMembershipRow(entry)
  })
}

/**
 * All org ids where the user holds an ACTIVE orgMembers row.
 * Filtered by the canonical predicate — revoked/disabled/deleted rows never
 * surface here.
 */
export async function activeOrgMembershipOrgIds(uid: string): Promise<string[]> {
  const cleanUid = cleanString(uid)
  if (!cleanUid) return []
  const snap = await adminDb.collection('orgMembers').where('uid', '==', cleanUid).get()
  const ids = new Set<string>()
  for (const doc of snap.docs) {
    const row = doc.data() ?? {}
    if (!isActiveOrgMembershipRow(row)) continue
    const orgId = cleanString(row.orgId) || orgIdFromMemberDocId(doc.id, cleanUid)
    if (orgId) ids.add(orgId)
  }
  return Array.from(ids)
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
