// lib/crm/facts/store.ts
// Firestore access for contact_facts (multi-tenant, org-scoped).

import { FieldValue, type Query } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ContactFact, FactField, FactStatus } from './types'

export const CONTACT_FACTS_COLLECTION = 'contact_facts'

export type ContactFactDoc = ContactFact

function col() {
  return adminDb.collection(CONTACT_FACTS_COLLECTION)
}

export function serializeFact(id: string, data: FirebaseFirestore.DocumentData): ContactFact {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    contactId: String(data.contactId ?? ''),
    field: data.field as FactField,
    value: String(data.value ?? ''),
    score: typeof data.score === 'number' ? data.score : 0,
    band: data.band,
    status: data.status,
    evidence: Array.isArray(data.evidence) ? data.evidence : [],
    method: String(data.method ?? ''),
    sourceUrl: data.sourceUrl ?? null,
    sessionId: data.sessionId ?? null,
    agentId: data.agentId ?? null,
    rationale: String(data.rationale ?? ''),
    observedAt: data.observedAt ?? null,
    supersededAt: data.supersededAt ?? null,
    decidedAt: data.decidedAt ?? null,
    decidedByRef: data.decidedByRef ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdByRef: data.createdByRef ?? null,
    deleted: data.deleted === true,
  }
}

export async function getFactById(
  orgId: string,
  factId: string,
): Promise<ContactFact | null> {
  const snap = await col().doc(factId).get()
  if (!snap.exists) return null
  const data = snap.data()!
  if (data.orgId !== orgId || data.deleted === true) return null
  return serializeFact(snap.id, data)
}

export async function listContactFacts(args: {
  orgId: string
  contactId: string
  status?: FactStatus | FactStatus[]
  field?: FactField
  includeDeleted?: boolean
  limit?: number
}): Promise<ContactFact[]> {
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
  let q: Query = col()
    .where('orgId', '==', args.orgId)
    .where('contactId', '==', args.contactId)

  if (args.field) {
    q = q.where('field', '==', args.field)
  }

  // Status filter: single equality when one value; multi-status filtered in memory
  // to avoid composite-index pressure (same pattern as Research list routes).
  const statuses = args.status
    ? Array.isArray(args.status)
      ? args.status
      : [args.status]
    : null

  if (statuses && statuses.length === 1) {
    q = q.where('status', '==', statuses[0])
  }

  const snap = await q.limit(limit * 2).get()
  let rows = snap.docs.map((d) => serializeFact(d.id, d.data()))

  if (!args.includeDeleted) {
    rows = rows.filter((r) => !r.deleted)
  }
  if (statuses && statuses.length > 1) {
    const set = new Set(statuses)
    rows = rows.filter((r) => set.has(r.status))
  }

  // Newest first when timestamps available
  rows.sort((a, b) => {
    const am = (a.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
    const bm = (b.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
    return bm - am
  })

  return rows.slice(0, limit)
}

export async function findActiveFactsForField(args: {
  orgId: string
  contactId: string
  field: FactField
}): Promise<ContactFact[]> {
  const rows = await listContactFacts({
    orgId: args.orgId,
    contactId: args.contactId,
    field: args.field,
    limit: 100,
  })
  return rows.filter((r) => r.status === 'APPLIED' || r.status === 'PROPOSED')
}

export async function findDismissedMatch(args: {
  orgId: string
  contactId: string
  field: FactField
  value: string
  sameValue: (a: string, b: string) => boolean
}): Promise<ContactFact | null> {
  const rows = await listContactFacts({
    orgId: args.orgId,
    contactId: args.contactId,
    field: args.field,
    status: 'DISMISSED',
    limit: 100,
  })
  return rows.find((r) => args.sameValue(r.value, args.value)) ?? null
}

export async function createFactDoc(
  data: Omit<ContactFact, 'id' | 'createdAt' | 'updatedAt' | 'observedAt'> & {
    observedAt?: unknown
  },
): Promise<string> {
  const ref = col().doc()
  await ref.set({
    ...data,
    deleted: false,
    observedAt: data.observedAt ?? FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}

export async function updateFactDoc(
  factId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await col().doc(factId).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function supersedeFacts(args: {
  factIds: string[]
}): Promise<void> {
  if (args.factIds.length === 0) return
  const batch = adminDb.batch()
  const now = FieldValue.serverTimestamp()
  for (const id of args.factIds) {
    batch.update(col().doc(id), {
      status: 'SUPERSEDED',
      supersededAt: now,
      updatedAt: now,
    })
  }
  await batch.commit()
}
