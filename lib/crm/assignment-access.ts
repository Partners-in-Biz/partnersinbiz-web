import { adminDb } from '@/lib/firebase/admin'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

type AssignmentRef = { uid?: unknown }

export type AssignableCrmRecord = {
  id?: string
  orgId?: unknown
  deleted?: unknown
  assignedTo?: unknown
  assignedToRef?: AssignmentRef
  ownerUid?: unknown
  ownerRef?: AssignmentRef
  accountManagerUid?: unknown
  accountManagerRef?: AssignmentRef
  allowedUserIds?: unknown
  assignedUserIds?: unknown
  companyId?: unknown
  companyName?: unknown
  sourceCompanyId?: unknown
  contactId?: unknown
  sourceContactId?: unknown
  companyLinks?: unknown
}

export type CrmAssignmentMaps = {
  companies?: Map<string, AssignableCrmRecord>
  contacts?: Map<string, AssignableCrmRecord>
}

export function isCrmPrivilegedActor(ctx: CrmAuthContext): boolean {
  return ctx.isAgent || ctx.role === 'system' || ctx.role === 'owner' || ctx.role === 'admin'
}

export function crmActorUid(ctx: CrmAuthContext): string {
  return ctx.user?.uid || ctx.actor.uid || ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export function normalizeAllowedUserIds(value: unknown): string[] {
  return Array.from(new Set(stringArray(value).map((uid) => uid.trim()).filter(Boolean)))
}

export function normalizeAllowedUserPatch(value: unknown): string[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return null
  return normalizeAllowedUserIds(value)
}

export function crmRecordAssignedToUid(record: AssignableCrmRecord | null | undefined, uid: string): boolean {
  if (!record || !uid) return false

  const directValues = [
    record.assignedTo,
    record.assignedToRef?.uid,
    record.ownerUid,
    record.ownerRef?.uid,
    record.accountManagerUid,
    record.accountManagerRef?.uid,
  ]

  if (directValues.some((value) => stringValue(value) === uid)) return true
  if (normalizeAllowedUserIds(record.allowedUserIds).includes(uid)) return true
  if (normalizeAllowedUserIds(record.assignedUserIds).includes(uid)) return true

  return false
}

export function crmRecordCompanyIds(record: AssignableCrmRecord | null | undefined): string[] {
  if (!record) return []
  const ids = new Set<string>()
  for (const value of [record.companyId, record.sourceCompanyId]) {
    const id = stringValue(value)
    if (id) ids.add(id)
  }

  if (Array.isArray(record.companyLinks)) {
    for (const link of record.companyLinks) {
      if (!link || typeof link !== 'object') continue
      const id = stringValue((link as { companyId?: unknown }).companyId)
      if (id) ids.add(id)
    }
  }

  return Array.from(ids)
}

export function crmRecordContactIds(record: AssignableCrmRecord | null | undefined): string[] {
  if (!record) return []
  const ids = new Set<string>()
  for (const value of [record.contactId, record.sourceContactId]) {
    const id = stringValue(value)
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

export function crmActorCanReadRecord(
  ctx: CrmAuthContext,
  record: AssignableCrmRecord,
  maps: CrmAssignmentMaps = {},
): boolean {
  if (isCrmPrivilegedActor(ctx)) return true
  if (record.orgId !== ctx.orgId || record.deleted === true) return false

  const uid = crmActorUid(ctx)
  if (crmRecordAssignedToUid(record, uid)) return true

  for (const companyId of crmRecordCompanyIds(record)) {
    if (crmRecordAssignedToUid(maps.companies?.get(companyId), uid)) return true
  }

  for (const contactId of crmRecordContactIds(record)) {
    const contact = maps.contacts?.get(contactId)
    if (crmRecordAssignedToUid(contact, uid)) return true
    for (const companyId of crmRecordCompanyIds(contact)) {
      if (crmRecordAssignedToUid(maps.companies?.get(companyId), uid)) return true
    }
  }

  return false
}

export function filterCrmRowsForActor<T extends AssignableCrmRecord>(
  ctx: CrmAuthContext,
  rows: T[],
  maps: CrmAssignmentMaps = {},
): T[] {
  if (isCrmPrivilegedActor(ctx)) return rows
  return rows.filter((row) => crmActorCanReadRecord(ctx, row, maps))
}

export async function crmActorCanReadCompanyRecord(
  ctx: CrmAuthContext,
  companyId: string,
  company: AssignableCrmRecord,
): Promise<boolean> {
  if (crmActorCanReadRecord(ctx, company)) return true
  if (isCrmPrivilegedActor(ctx)) return true
  const uid = crmActorUid(ctx)
  if (!uid || !companyId) return false

  const snap = await adminDb.collection('contacts')
    .where('orgId', '==', ctx.orgId)
    .limit(1000)
    .get()

  return snap.docs.some((doc) => {
    const contact = { id: doc.id, ...doc.data() } as AssignableCrmRecord
    if (contact.deleted === true || !crmRecordAssignedToUid(contact, uid)) return false
    return crmRecordCompanyIds(contact).includes(companyId)
  })
}

async function loadAssignmentMap(
  collectionName: 'companies' | 'contacts',
  orgId: string,
  ids: Iterable<string>,
): Promise<Map<string, AssignableCrmRecord>> {
  const uniqueIds = Array.from(new Set(Array.from(ids).filter(Boolean)))
  const entries: Array<readonly [string, AssignableCrmRecord]> = []
  await Promise.all(uniqueIds.map(async (id) => {
    const snap = await adminDb.collection(collectionName).doc(id).get()
    if (!snap.exists) return
    const data = snap.data() as AssignableCrmRecord
    if (data.orgId !== orgId || data.deleted === true) return
    entries.push([id, { ...data, id }])
  }))
  return new Map(entries)
}

export async function loadCompanyAssignmentMap(
  orgId: string,
  ids: Iterable<string>,
): Promise<Map<string, AssignableCrmRecord>> {
  return loadAssignmentMap('companies', orgId, ids)
}

export async function loadContactAssignmentMap(
  orgId: string,
  ids: Iterable<string>,
): Promise<Map<string, AssignableCrmRecord>> {
  return loadAssignmentMap('contacts', orgId, ids)
}
