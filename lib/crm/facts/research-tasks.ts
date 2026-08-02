// lib/crm/facts/research-tasks.ts
// Optional resident CRM research queue with schedule_recheck reasons + budget.

import { FieldValue, type Query } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export const CRM_RESEARCH_TASKS_COLLECTION = 'crm_research_tasks'

export type ResearchTaskStatus =
  | 'pending'
  | 'leased'
  | 'done'
  | 'cancelled'
  | 'failed'

export type ResearchTaskKind =
  | 'enrich_contact'
  | 'recheck_contact'
  | 'enrich_company'
  | 'job_change_check'
  | 'mailbox_identity'
  | 'custom'

export interface CrmResearchTask {
  id: string
  orgId: string
  kind: ResearchTaskKind
  status: ResearchTaskStatus
  /** Why this work exists — visible to reps */
  reason: string
  contactId?: string | null
  companyId?: string | null
  dealId?: string | null
  /** When the task becomes eligible */
  dueAt: unknown
  /** Vendor / external lookup budget remaining for this task */
  budgetUnits: number
  budgetSpent: number
  priority: number
  leaseOwner?: string | null
  leaseExpiresAt?: unknown
  lastError?: string | null
  resultSummary?: string | null
  metadata?: Record<string, unknown>
  createdByRef?: MemberRef | null
  createdAt: unknown
  updatedAt: unknown
  completedAt?: unknown
  deleted?: boolean
}

export interface ScheduleRecheckInput {
  orgId: string
  contactId?: string
  companyId?: string
  dealId?: string
  kind?: ResearchTaskKind
  /** Rep-visible reason (required) */
  reason: string
  /** Seconds from now until due (default 7 days) */
  delaySeconds?: number
  budgetUnits?: number
  priority?: number
  metadata?: Record<string, unknown>
  createdByRef?: MemberRef | null
  agentId?: string | null
}

function col() {
  return adminDb.collection(CRM_RESEARCH_TASKS_COLLECTION)
}

function serialize(id: string, data: FirebaseFirestore.DocumentData): CrmResearchTask {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    kind: data.kind,
    status: data.status,
    reason: String(data.reason ?? ''),
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    dueAt: data.dueAt ?? null,
    budgetUnits: typeof data.budgetUnits === 'number' ? data.budgetUnits : 0,
    budgetSpent: typeof data.budgetSpent === 'number' ? data.budgetSpent : 0,
    priority: typeof data.priority === 'number' ? data.priority : 0,
    leaseOwner: data.leaseOwner ?? null,
    leaseExpiresAt: data.leaseExpiresAt ?? null,
    lastError: data.lastError ?? null,
    resultSummary: data.resultSummary ?? null,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    createdByRef: data.createdByRef ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    completedAt: data.completedAt ?? null,
    deleted: data.deleted === true,
  }
}

/**
 * schedule_recheck: agent or system queues follow-up research with a human-visible reason.
 */
export async function scheduleRecheck(input: ScheduleRecheckInput): Promise<{ id: string }> {
  const reason = String(input.reason || '').trim()
  if (!reason) throw new Error('reason is required')
  if (!input.contactId && !input.companyId && !input.dealId) {
    throw new Error('contactId, companyId, or dealId is required')
  }

  const delaySeconds = Math.max(60, input.delaySeconds ?? 7 * 24 * 3600)
  const dueMs = Date.now() + delaySeconds * 1000
  const budgetUnits = Math.max(0, Math.min(100, input.budgetUnits ?? 3))

  const ref = col().doc()
  await ref.set({
    orgId: input.orgId,
    kind: input.kind ?? 'recheck_contact',
    status: 'pending',
    reason: reason.slice(0, 1000),
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    dueAt: new Date(dueMs),
    budgetUnits,
    budgetSpent: 0,
    priority: input.priority ?? 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    resultSummary: null,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.agentId ? { scheduledByAgentId: input.agentId } : {}),
    },
    createdByRef: input.createdByRef ?? null,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function listResearchTasks(args: {
  orgId: string
  contactId?: string
  status?: ResearchTaskStatus
  dueBefore?: Date
  limit?: number
}): Promise<CrmResearchTask[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
  let q: Query = col().where('orgId', '==', args.orgId)

  if (args.contactId) q = q.where('contactId', '==', args.contactId)
  if (args.status) q = q.where('status', '==', args.status)

  const snap = await q.limit(limit * 2).get()
  let rows = snap.docs.map((d) => serialize(d.id, d.data())).filter((r) => !r.deleted)

  if (args.dueBefore) {
    const before = args.dueBefore.getTime()
    rows = rows.filter((r) => {
      const t = (r.dueAt as { toMillis?: () => number; getTime?: () => number } | Date | null)
      if (!t) return true
      if (typeof (t as { toMillis?: () => number }).toMillis === 'function') {
        return (t as { toMillis: () => number }).toMillis() <= before
      }
      if (t instanceof Date) return t.getTime() <= before
      return true
    })
  }

  rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  return rows.slice(0, limit)
}

/**
 * Lease due pending work (best-effort single-doc transaction).
 * Multi-worker safe via transaction check on status + lease.
 */
export async function leaseNextResearchTask(args: {
  orgId: string
  workerId: string
  leaseSeconds?: number
}): Promise<CrmResearchTask | null> {
  const due = await listResearchTasks({
    orgId: args.orgId,
    status: 'pending',
    dueBefore: new Date(),
    limit: 20,
  })
  if (due.length === 0) return null

  const leaseSeconds = Math.max(30, args.leaseSeconds ?? 300)
  const leaseExpires = new Date(Date.now() + leaseSeconds * 1000)
  const candidate = due[0]!

  try {
    await adminDb.runTransaction(async (tx) => {
      const ref = col().doc(candidate.id)
      const snap = await tx.get(ref)
      if (!snap.exists) throw new Error('gone')
      const data = snap.data()!
      if (data.orgId !== args.orgId || data.status !== 'pending' || data.deleted === true) {
        throw new Error('not_pending')
      }
      tx.update(ref, {
        status: 'leased',
        leaseOwner: args.workerId,
        leaseExpiresAt: leaseExpires,
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  } catch {
    return null
  }

  const refreshed = await col().doc(candidate.id).get()
  if (!refreshed.exists) return null
  return serialize(refreshed.id, refreshed.data()!)
}

export async function completeResearchTask(args: {
  orgId: string
  taskId: string
  resultSummary?: string
  budgetSpentDelta?: number
  failed?: boolean
  error?: string
}): Promise<void> {
  const ref = col().doc(args.taskId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('not_found')
  const data = snap.data()!
  if (data.orgId !== args.orgId) throw new Error('scope_mismatch')

  const spent =
    (typeof data.budgetSpent === 'number' ? data.budgetSpent : 0) +
    Math.max(0, args.budgetSpentDelta ?? 0)

  await ref.update({
    status: args.failed ? 'failed' : 'done',
    budgetSpent: spent,
    resultSummary: args.resultSummary ? String(args.resultSummary).slice(0, 2000) : null,
    lastError: args.failed ? String(args.error ?? 'failed').slice(0, 1000) : null,
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    leaseOwner: null,
    leaseExpiresAt: null,
  })
}
