// lib/crm/facts/research-tasks.ts
// Optional resident CRM research queue with schedule_recheck reasons + budget.

import { FieldValue, type DocumentData, type Query } from 'firebase-admin/firestore'
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

function serialize(id: string, data: DocumentData): CrmResearchTask {
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

  // 0 = due immediately (worker/cron eligible on next poll). Cap far-future noise at 365d.
  const rawDelay =
    typeof input.delaySeconds === 'number' && Number.isFinite(input.delaySeconds)
      ? input.delaySeconds
      : 7 * 24 * 3600
  const delaySeconds = Math.max(0, Math.min(365 * 24 * 3600, Math.floor(rawDelay)))
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

function dueAtMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (typeof (value as { getTime?: () => number }).getTime === 'function') {
    return (value as { getTime: () => number }).getTime()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const n = new Date(value).getTime()
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * List pending + expired-leased tasks that are eligible for work on any machine.
 * Multi-worker safe when paired with transactional lease.
 *
 * Pending due work uses orgId+status+dueAt (indexed) so large queues of not-yet-due
 * tasks cannot starve the leasable head.
 */
export async function listLeasableResearchTasks(args: {
  orgId: string
  limit?: number
  now?: Date
}): Promise<CrmResearchTask[]> {
  const now = args.now ?? new Date()
  const nowMs = now.getTime()
  const limit = Math.min(Math.max(args.limit ?? 40, 1), 100)

  let pending: CrmResearchTask[] = []
  try {
    const pendingSnap = await col()
      .where('orgId', '==', args.orgId)
      .where('status', '==', 'pending')
      .where('dueAt', '<=', now)
      .orderBy('dueAt', 'asc')
      .limit(limit)
      .get()
    pending = pendingSnap.docs
      .map((d) => serialize(d.id, d.data()))
      .filter((r) => !r.deleted)
  } catch {
    // Index lag / emulator — fall back to status scan + in-memory due filter.
    pending = await listResearchTasks({
      orgId: args.orgId,
      status: 'pending',
      dueBefore: now,
      limit,
    })
  }

  // Expired leases become reclaimable so multi-machine workers cannot stall.
  const leasedSnap = await col()
    .where('orgId', '==', args.orgId)
    .where('status', '==', 'leased')
    .limit(Math.min(limit * 2, 100))
    .get()

  const expiredLeased = leasedSnap.docs
    .map((d) => serialize(d.id, d.data()))
    .filter((r) => !r.deleted)
    .filter((r) => {
      if (dueAtMs(r.dueAt) > nowMs) return false
      const exp = dueAtMs(r.leaseExpiresAt)
      return exp > 0 && exp <= nowMs
    })

  const merged = [...pending, ...expiredLeased]
  const byId = new Map<string, CrmResearchTask>()
  for (const row of merged) byId.set(row.id, row)

  return Array.from(byId.values())
    .sort((a, b) => {
      const p = (b.priority ?? 0) - (a.priority ?? 0)
      if (p !== 0) return p
      return dueAtMs(a.dueAt) - dueAtMs(b.dueAt)
    })
    .slice(0, limit)
}

/**
 * Lease due pending (or expired-leased) work.
 * Multi-worker / multi-machine safe via transaction + candidate walk.
 * Mirrors Comp-style claim: one worker wins; others continue to next due task.
 */
export async function leaseNextResearchTask(args: {
  orgId: string
  workerId: string
  leaseSeconds?: number
}): Promise<CrmResearchTask | null> {
  const candidates = await listLeasableResearchTasks({
    orgId: args.orgId,
    limit: 40,
  })
  if (candidates.length === 0) return null

  const leaseSeconds = Math.max(30, Math.min(3600, args.leaseSeconds ?? 300))
  const nowMs = Date.now()
  const leaseExpires = new Date(nowMs + leaseSeconds * 1000)
  const workerId = String(args.workerId || '').trim().slice(0, 120)
  if (!workerId) return null

  for (const candidate of candidates) {
    try {
      const leasedId = await adminDb.runTransaction(async (tx) => {
        const ref = col().doc(candidate.id)
        const snap = await tx.get(ref)
        if (!snap.exists) throw new Error('gone')
        const data = snap.data()!
        if (data.orgId !== args.orgId || data.deleted === true) {
          throw new Error('scope')
        }

        const status = String(data.status || '')
        if (status === 'pending') {
          // ok
        } else if (status === 'leased') {
          const exp = dueAtMs(data.leaseExpiresAt)
          if (!(exp > 0 && exp <= nowMs)) throw new Error('still_leased')
        } else {
          throw new Error('not_leasable')
        }

        // Due check inside txn so late dueAt changes cannot be claimed early.
        if (dueAtMs(data.dueAt) > nowMs) throw new Error('not_due')

        tx.update(ref, {
          status: 'leased',
          leaseOwner: workerId,
          leaseExpiresAt: leaseExpires,
          lastError: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return candidate.id
      })

      const refreshed = await col().doc(leasedId).get()
      if (!refreshed.exists) continue
      return serialize(refreshed.id, refreshed.data()!)
    } catch {
      // Contention or race — try next candidate (multi-machine safe).
      continue
    }
  }

  return null
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
