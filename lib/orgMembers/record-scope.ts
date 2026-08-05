import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import {
  type AssignableCrmRecord,
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  crmRecordContactIds,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'
import {
  canAccessAllModuleRecords,
  recordScopeFor,
  type RecordScopedModuleKey,
  type RecordScope,
} from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'

/**
 * Effective record scope for a module for an org member. Platform admins/AI
 * always get 'all'. Members without an active orgMembers row default to the
 * module default (owned_or_linked for CRM/Projects, all for the rest).
 */
export async function effectiveRecordScopeForModule(
  user: ApiUser,
  orgId: string,
  moduleKey: RecordScopedModuleKey,
): Promise<RecordScope> {
  if (user.role === 'admin' || user.role === 'ai') return 'all'
  const policy = await loadOrgMemberAccessPolicy(orgId, user.uid)
  if (!policy) return recordScopeFor(null, moduleKey)
  return recordScopeFor(policy, moduleKey)
}

/** True when the member may see the full module record set (not just their own). */
export async function memberSeesAllModuleRecords(
  user: ApiUser,
  orgId: string,
  moduleKey: RecordScopedModuleKey,
): Promise<boolean> {
  return (await effectiveRecordScopeForModule(user, orgId, moduleKey)) === 'all'
}

/**
 * Ownership-bearing rows (research, marketing, documents) filtered to the
 * actor's book when the module record scope is owned_or_linked. Rows are kept
 * when the actor created them, was explicitly shared them, or they link to a
 * CRM company/contact the actor owns or is assigned.
 */
export type OwnedRowLike = {
  id?: string
  createdBy?: unknown
  createdByRef?: unknown
  ownerUid?: unknown
  sharedWithUserIds?: unknown
  allowedUserIds?: unknown
  linked?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function linkedIds(value: unknown, field: 'companyIds' | 'contactIds' | 'companyId' | 'contactId'): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const ids = new Set<string>()
  for (const key of [field]) {
    const direct = record[key]
    if (typeof direct === 'string' && direct) ids.add(direct)
  }
  for (const key of field === 'companyIds' ? ['companyIds'] : field === 'contactIds' ? ['contactIds'] : []) {
    for (const id of stringArray(record[key])) ids.add(id)
  }
  return Array.from(ids)
}

export function actorOwnsRow(row: OwnedRowLike, uid: string): boolean {
  if (!uid) return false
  const createdBy = cleanString(row.createdBy) || (row.createdByRef && typeof row.createdByRef === 'object'
    ? cleanString((row.createdByRef as { uid?: unknown }).uid)
    : '')
  if (createdBy === uid) return true
  if (cleanString(row.ownerUid) === uid) return true
  return stringArray(row.sharedWithUserIds).includes(uid) || stringArray(row.allowedUserIds).includes(uid)
}

export async function filterOwnedRowsForActor<T extends OwnedRowLike>(
  user: ApiUser,
  orgId: string,
  moduleKey: RecordScopedModuleKey,
  rows: T[],
): Promise<T[]> {
  if (await memberSeesAllModuleRecords(user, orgId, moduleKey)) return rows

  const uid = user.uid
  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const row of rows) {
    for (const id of linkedIds(row.linked, 'companyIds')) companyIds.add(id)
    for (const id of linkedIds(row.linked, 'companyId')) companyIds.add(id)
    for (const id of linkedIds(row.linked, 'contactIds')) contactIds.add(id)
    for (const id of linkedIds(row.linked, 'contactId')) contactIds.add(id)
  }
  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(orgId, companyIds),
    loadContactAssignmentMap(orgId, contactIds),
  ])

  return rows.filter((row) => {
    if (actorOwnsRow(row, uid)) return true
    const linkedCompanies = linkedIds(row.linked, 'companyIds')
    const linkedContacts = linkedIds(row.linked, 'contactIds')
    for (const id of linkedCompanies) {
      if (crmRecordAssignedToUid(companies.get(id) as AssignableCrmRecord | undefined, uid)) return true
    }
    for (const id of linkedContacts) {
      const contact = contacts.get(id) as AssignableCrmRecord | undefined
      if (crmRecordAssignedToUid(contact, uid)) return true
      for (const companyId of crmRecordCompanyIds(contact)) {
        if (crmRecordAssignedToUid(companies.get(companyId) as AssignableCrmRecord | undefined, uid)) return true
      }
    }
    return false
  })
}

/** Export helpers reused by the Team editor so scope defaults are visible client-side. */
export { canAccessAllModuleRecords }
