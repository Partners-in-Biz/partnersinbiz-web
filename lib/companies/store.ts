// lib/companies/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { Company, CompanyInput } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const COMPANIES = 'companies'
const ORG_MEMBERS = 'orgMembers'

export interface LoadedCompany {
  ref: FirebaseFirestore.DocumentReference
  data: Company
}

export async function loadCompany(id: string, orgId: string): Promise<LoadedCompany | null> {
  if (!id || !orgId) return null
  const ref = adminDb.collection(COMPANIES).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as Company
  if (data.orgId !== orgId) return null
  if (data.deleted === true) return null
  return { ref, data: { ...data, id: ref.id } }
}

export type CompanyDuplicateMatch = {
  id: string
  name?: string
  domain?: string
  website?: string
  linkedOrgId?: string
  reason: 'linkedOrgId' | 'domain' | 'name'
}

export function normalizeCompanyName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : ''
}

export function normalizeCompanyHost(value: unknown): string {
  if (typeof value !== 'string') return ''
  const raw = value.trim().toLowerCase()
  if (!raw) return ''
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const parsed = new URL(withProtocol)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:.+$/, '')
      .trim()
  }
}

function companyIdentityHosts(company: Partial<CompanyInput> | Partial<Company>): Set<string> {
  return new Set([normalizeCompanyHost(company.domain), normalizeCompanyHost(company.website)].filter(Boolean))
}

function companyIdentityNames(company: Partial<CompanyInput> | Partial<Company>): Set<string> {
  return new Set([
    normalizeCompanyName(company.name),
    normalizeCompanyName(company.legalName),
    normalizeCompanyName(company.tradingName),
  ].filter(Boolean))
}

export async function findDuplicateCompany(
  orgId: string,
  input: Partial<CompanyInput>,
  excludeId?: string,
): Promise<CompanyDuplicateMatch | null> {
  if (!orgId) return null
  const inputLinkedOrgId = typeof input.linkedOrgId === 'string' ? input.linkedOrgId.trim() : ''
  const inputHosts = companyIdentityHosts(input)
  const inputNames = companyIdentityNames(input)
  if (!inputLinkedOrgId && inputHosts.size === 0 && inputNames.size === 0) return null

  const snap = await adminDb.collection(COMPANIES)
    .where('orgId', '==', orgId)
    .limit(1000)
    .get()

  for (const doc of snap.docs) {
    if (excludeId && doc.id === excludeId) continue
    const data = doc.data() as Company
    if (data.deleted === true) continue

    if (inputLinkedOrgId && data.linkedOrgId === inputLinkedOrgId) {
      return { id: doc.id, name: data.name, domain: data.domain, website: data.website, linkedOrgId: data.linkedOrgId, reason: 'linkedOrgId' }
    }

    const existingHosts = companyIdentityHosts(data)
    for (const host of inputHosts) {
      if (existingHosts.has(host)) {
        return { id: doc.id, name: data.name, domain: data.domain, website: data.website, linkedOrgId: data.linkedOrgId, reason: 'domain' }
      }
    }

    const existingNames = companyIdentityNames(data)
    for (const name of inputNames) {
      if (existingNames.has(name)) {
        return { id: doc.id, name: data.name, domain: data.domain, website: data.website, linkedOrgId: data.linkedOrgId, reason: 'name' }
      }
    }
  }

  return null
}

// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
const NEVER_FROM_BODY = new Set([
  'id', 'orgId',
  'createdBy', 'createdByRef', 'createdAt',
  'updatedBy', 'updatedByRef', 'updatedAt',
  'deleted',
])

const LEGAL_STRING_FIELDS = new Set([
  'legalName',
  'tradingName',
  'registrationNumber',
  'vatNumber',
  'taxNumber',
  'phone',
  'purchaseOrderNumber',
  'invoiceInstructions',
])

const BILLING_ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'country', 'postalCode'] as const
const AGREEMENT_CONTACT_FIELDS = ['name', 'title', 'email', 'phone'] as const

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function cleanEmail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanStringMap<T extends readonly string[]>(
  value: unknown,
  fields: T,
  emailFields: Set<string> = new Set(),
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const field of fields) {
    const cleaned = emailFields.has(field) ? cleanEmail(value[field]) : cleanString(value[field])
    if (cleaned !== undefined) out[field] = cleaned
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function sanitizeCompanyForWrite(input: Partial<CompanyInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    if (k === 'domain' && typeof v === 'string') {
      out[k] = v.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      continue
    }
    if (LEGAL_STRING_FIELDS.has(k)) {
      out[k] = typeof v === 'string' ? v.trim() : v
      continue
    }
    if (k === 'billingEmail') {
      out[k] = typeof v === 'string' ? v.trim().toLowerCase() : v
      continue
    }
    if (k === 'billingAddress') {
      const cleaned = cleanStringMap(v, BILLING_ADDRESS_FIELDS)
      if (cleaned) out[k] = cleaned
      continue
    }
    if (k === 'accountsContact' || k === 'authorizedSignatory') {
      const cleaned = cleanStringMap(v, AGREEMENT_CONTACT_FIELDS, new Set(['email']))
      if (cleaned) out[k] = cleaned
      continue
    }
    if (k === 'purchaseOrderRequired') {
      out[k] = v === true
      continue
    }
    out[k] = v
  }
  if (!('tags' in out)) out.tags = []
  if (!('notes' in out)) out.notes = ''
  return out
}

export async function validateParentChain(orgId: string, selfId: string | undefined, parentId: string | undefined): Promise<boolean> {
  if (!parentId) return true
  if (selfId && selfId === parentId) return false
  const visited = new Set<string>()
  if (selfId) visited.add(selfId)
  let cur: string | undefined = parentId
  for (let depth = 0; depth < 10 && cur; depth++) {
    if (visited.has(cur)) return false
    visited.add(cur)
    const snap = await adminDb.collection(COMPANIES).doc(cur).get()
    if (!snap.exists) return true  // dangling parent — caller can decide; we allow
    const data = snap.data() as Company
    if (data.orgId !== orgId) return false  // cross-tenant parent is invalid
    cur = data.parentCompanyId
  }
  return true
}

export async function validateAccountManager(orgId: string, uid: string | undefined): Promise<boolean> {
  if (!uid) return true
  const snap = await adminDb.collection(ORG_MEMBERS).doc(`${orgId}_${uid}`).get()
  return snap.exists
}

/** Resolve the orgMembers doc for a uid into a MemberRef snapshot, or null on miss. */
export async function loadMemberRef(orgId: string, uid: string | undefined): Promise<MemberRef | null> {
  if (!uid) return null
  const snap = await adminDb.collection(ORG_MEMBERS).doc(`${orgId}_${uid}`).get()
  if (!snap.exists) return null
  const data = snap.data() as { firstName?: string; lastName?: string; avatarUrl?: string; jobTitle?: string }
  const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ') || uid
  const ref: MemberRef = { uid, displayName, kind: 'human' }
  if (data.avatarUrl) ref.avatarUrl = data.avatarUrl
  if (data.jobTitle) ref.jobTitle = data.jobTitle
  return ref
}

export async function clearCompanyIdOnCollection(coll: string, orgId: string, companyId: string): Promise<number> {
  let cleared = 0
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  while (true) {
    let q = adminDb.collection(coll)
      .where('orgId', '==', orgId)
      .where('companyId', '==', companyId)
      .limit(30)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    const batch = adminDb.batch()
    snap.docs.forEach(d => {
      batch.update(d.ref, { companyId: FieldValue.delete(), companyName: FieldValue.delete() })
    })
    await batch.commit()
    cleared += snap.size
    if (snap.size < 30) break
    cursor = snap.docs[snap.docs.length - 1]
  }
  return cleared
}
