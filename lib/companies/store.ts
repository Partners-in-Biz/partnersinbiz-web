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

// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
const NEVER_FROM_BODY = new Set([
  'id', 'orgId',
  'createdBy', 'createdByRef', 'createdAt',
  'updatedBy', 'updatedByRef', 'updatedAt',
  'deleted',
])

export function sanitizeCompanyForWrite(input: Partial<CompanyInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    if (k === 'domain' && typeof v === 'string') {
      out[k] = v.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
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
