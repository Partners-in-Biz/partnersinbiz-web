// lib/crm/facts/research-worker.ts
// Multi-machine CRM research queue worker — lease + process payload-backed enrichment.
// Cron and Hermes agents both call into this module.

import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { applyMailboxFactsToContact } from './apply-mailbox'
import { isEvidenceKind } from './evidence'
import { isFactField } from './fields'
import { recordContactFact } from './record'
import {
  CRM_RESEARCH_TASKS_COLLECTION,
  completeResearchTask,
  leaseNextResearchTask,
  listLeasableResearchTasks,
  type CrmResearchTask,
  type ResearchTaskKind,
} from './research-tasks'
import type { Evidence, FactContactView, FactField } from './types'

const WORKER_METHOD = 'crm.research_worker'

export interface ProcessResearchTaskResult {
  taskId: string
  orgId: string
  ok: boolean
  failed: boolean
  resultSummary: string
  budgetSpentDelta: number
  factsStored: number
  factsApplied: number
  error?: string
}

export interface ResearchWorkerBatchResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  errors: string[]
  results: ProcessResearchTaskResult[]
}

function col() {
  return adminDb.collection(CRM_RESEARCH_TASKS_COLLECTION)
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseEvidenceList(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return []
  const out: Evidence[] = []
  for (const item of raw) {
    const row = asRecord(item)
    const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
    const detail = typeof row.detail === 'string' ? row.detail.trim() : ''
    // Reject unknown kinds (including model.confidence) — same contract as the facts API.
    if (!kind || !detail || !isEvidenceKind(kind)) continue
    out.push({
      kind,
      detail: detail.slice(0, 2000),
      ...(typeof row.sourceUrl === 'string' && row.sourceUrl.trim()
        ? { sourceUrl: row.sourceUrl.trim().slice(0, 2000) }
        : {}),
    })
  }
  return out
}

async function loadFactContact(
  orgId: string,
  contactId: string,
): Promise<FactContactView | null> {
  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return null
  const data = snap.data()!
  if (data.orgId !== orgId || data.deleted === true) return null
  return { id: snap.id, orgId, ...data } as FactContactView
}

async function logResearchActivity(args: {
  orgId: string
  contactId: string
  companyId?: string | null
  task: CrmResearchTask
  summary: string
  workerId: string
  factsStored: number
  factsApplied: number
}): Promise<void> {
  try {
    await adminDb.collection('activities').add({
      orgId: args.orgId,
      contactId: args.contactId,
      companyId: args.companyId ?? '',
      dealId: args.task.dealId ?? '',
      type: 'note',
      summary: args.summary.slice(0, 500),
      metadata: {
        source: 'crm.research_worker',
        researchTaskId: args.task.id,
        researchKind: args.task.kind,
        researchReason: args.task.reason,
        workerId: args.workerId,
        factsStored: args.factsStored,
        factsApplied: args.factsApplied,
      },
      createdBy: `agent:${args.workerId}`,
      createdAt: FieldValue.serverTimestamp(),
      occurredAt: FieldValue.serverTimestamp(),
      deleted: false,
    })
  } catch (err) {
    console.error('[research-worker] activity log failed', args.task.id, err)
  }
}

/**
 * Global candidate scan for cron (cross-tenant).
 * Pending due work prefers status+dueAt (indexed) so not-yet-due backlog cannot starve workers.
 * Falls back to status-only scan when the composite index is not ready.
 */
export async function listGlobalLeasableResearchTasks(args?: {
  limit?: number
  now?: Date
}): Promise<CrmResearchTask[]> {
  const now = args?.now ?? new Date()
  const nowMs = now.getTime()
  const limit = Math.min(Math.max(args?.limit ?? 40, 1), 100)

  const serialize = (id: string, data: DocumentData): CrmResearchTask => ({
    id,
    orgId: String(data.orgId ?? ''),
    kind: data.kind as ResearchTaskKind,
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
  })

  let pending: CrmResearchTask[] = []
  try {
    const pendingDueSnap = await col()
      .where('status', '==', 'pending')
      .where('dueAt', '<=', now)
      .orderBy('dueAt', 'asc')
      .limit(Math.min(limit * 2, 100))
      .get()
    pending = pendingDueSnap.docs
      .map((d) => serialize(d.id, d.data()))
      .filter((r) => !r.deleted && r.orgId)
  } catch {
    const pendingSnap = await col()
      .where('status', '==', 'pending')
      .limit(Math.min(limit * 3, 200))
      .get()
    pending = pendingSnap.docs
      .map((d) => serialize(d.id, d.data()))
      .filter((r) => !r.deleted && r.orgId && dueAtMs(r.dueAt) <= nowMs)
  }

  const leasedSnap = await col()
    .where('status', '==', 'leased')
    .limit(Math.min(limit * 2, 100))
    .get()

  const expiredLeased = leasedSnap.docs
    .map((d) => serialize(d.id, d.data()))
    .filter((r) => {
      if (r.deleted || !r.orgId) return false
      if (dueAtMs(r.dueAt) > nowMs) return false
      const exp = dueAtMs(r.leaseExpiresAt)
      return exp > 0 && exp <= nowMs
    })

  const byId = new Map<string, CrmResearchTask>()
  for (const row of [...pending, ...expiredLeased]) byId.set(row.id, row)

  return Array.from(byId.values())
    .sort((a, b) => {
      const p = (b.priority ?? 0) - (a.priority ?? 0)
      if (p !== 0) return p
      return dueAtMs(a.dueAt) - dueAtMs(b.dueAt)
    })
    .slice(0, limit)
}

/**
 * Lease a specific candidate id (transactional). Used by global cron walk.
 */
export async function leaseResearchTaskById(args: {
  taskId: string
  orgId: string
  workerId: string
  leaseSeconds?: number
}): Promise<CrmResearchTask | null> {
  const workerId = String(args.workerId || '').trim().slice(0, 120)
  if (!workerId) return null
  const leaseSeconds = Math.max(30, Math.min(3600, args.leaseSeconds ?? 300))
  const nowMs = Date.now()
  const leaseExpires = new Date(nowMs + leaseSeconds * 1000)

  try {
    const leasedId = await adminDb.runTransaction(async (tx) => {
      const ref = col().doc(args.taskId)
      const snap = await tx.get(ref)
      if (!snap.exists) throw new Error('gone')
      const data = snap.data()!
      if (data.orgId !== args.orgId || data.deleted === true) throw new Error('scope')
      const status = String(data.status || '')
      if (status === 'pending') {
        // ok
      } else if (status === 'leased') {
        const exp = dueAtMs(data.leaseExpiresAt)
        if (!(exp > 0 && exp <= nowMs)) throw new Error('still_leased')
      } else {
        throw new Error('not_leasable')
      }
      if (dueAtMs(data.dueAt) > nowMs) throw new Error('not_due')
      tx.update(ref, {
        status: 'leased',
        leaseOwner: workerId,
        leaseExpiresAt: leaseExpires,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return args.taskId
    })

    const refreshed = await col().doc(leasedId).get()
    if (!refreshed.exists) return null
    const data = refreshed.data()!
    return {
      id: refreshed.id,
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
  } catch {
    return null
  }
}

export async function leaseNextResearchTaskGlobal(args: {
  workerId: string
  leaseSeconds?: number
  limit?: number
}): Promise<CrmResearchTask | null> {
  const candidates = await listGlobalLeasableResearchTasks({ limit: args.limit ?? 40 })
  for (const candidate of candidates) {
    const leased = await leaseResearchTaskById({
      taskId: candidate.id,
      orgId: candidate.orgId,
      workerId: args.workerId,
      leaseSeconds: args.leaseSeconds,
    })
    if (leased) return leased
  }
  return null
}

/**
 * Process one already-leased research task.
 * Payload-backed only for auto-enrichment (observations / bodyText).
 * Always surfaces a rep-visible activity when a contact is present.
 */
export async function processLeasedResearchTask(args: {
  task: CrmResearchTask
  workerId: string
}): Promise<ProcessResearchTaskResult> {
  const { task, workerId } = args
  let factsStored = 0
  let factsApplied = 0
  const notes: string[] = []

  try {
    if (!task.contactId && !task.companyId && !task.dealId) {
      const summary = 'Task had no contact/company/deal target.'
      await completeResearchTask({
        orgId: task.orgId,
        taskId: task.id,
        failed: true,
        error: summary,
        resultSummary: summary,
        budgetSpentDelta: 0,
      })
      return {
        taskId: task.id,
        orgId: task.orgId,
        ok: false,
        failed: true,
        resultSummary: summary,
        budgetSpentDelta: 0,
        factsStored: 0,
        factsApplied: 0,
        error: summary,
      }
    }

    const contact = task.contactId
      ? await loadFactContact(task.orgId, task.contactId)
      : null

    if (task.contactId && !contact) {
      const summary = 'Contact missing, deleted, or out of org scope.'
      await completeResearchTask({
        orgId: task.orgId,
        taskId: task.id,
        failed: true,
        error: summary,
        resultSummary: summary,
        budgetSpentDelta: 0,
      })
      return {
        taskId: task.id,
        orgId: task.orgId,
        ok: false,
        failed: true,
        resultSummary: summary,
        budgetSpentDelta: 0,
        factsStored: 0,
        factsApplied: 0,
        error: summary,
      }
    }

    const meta = asRecord(task.metadata)

    // 1) Mailbox body payload → local signature/reply facts
    const bodyText =
      typeof meta.bodyText === 'string'
        ? meta.bodyText
        : typeof meta.mailboxBodyText === 'string'
          ? meta.mailboxBodyText
          : ''
    if (contact && bodyText.trim()) {
      const mailbox = await applyMailboxFactsToContact({
        orgId: task.orgId,
        contact,
        bodyText,
        fromName: typeof meta.fromName === 'string' ? meta.fromName : null,
        fromEmail: typeof meta.fromEmail === 'string' ? meta.fromEmail : null,
        direction:
          meta.direction === 'inbound' || meta.direction === 'outbound'
            ? meta.direction
            : 'unknown',
        agentId: workerId,
        sourceUrl: typeof meta.sourceUrl === 'string' ? meta.sourceUrl : null,
      })
      factsStored += mailbox.storedCount
      factsApplied += mailbox.results.filter((r) => r.result.applied).length
      notes.push(`mailbox_candidates=${mailbox.candidateCount},stored=${mailbox.storedCount}`)
    }

    // 2) Explicit observation payloads from agents/schedulers
    const observationBlocks: unknown[] = []
    if (Array.isArray(meta.observations)) observationBlocks.push(...meta.observations)
    if (Array.isArray(meta.evidenceEntries)) observationBlocks.push(...meta.evidenceEntries)
    if (Array.isArray(meta.facts)) observationBlocks.push(...meta.facts)

    if (contact && observationBlocks.length > 0) {
      for (const raw of observationBlocks) {
        const row = asRecord(raw)
        const fieldRaw = typeof row.field === 'string' ? row.field.trim() : ''
        const value = typeof row.value === 'string' ? row.value.trim() : ''
        if (!fieldRaw || !value || !isFactField(fieldRaw)) continue
        const evidence = parseEvidenceList(row.evidence)
        if (evidence.length === 0) continue
        const result = await recordContactFact(
          {
            orgId: task.orgId,
            contactId: contact.id,
            field: fieldRaw as FactField,
            value,
            evidence,
            method:
              typeof row.method === 'string' && row.method.trim()
                ? row.method.trim().slice(0, 120)
                : WORKER_METHOD,
            sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : undefined,
            agentId: workerId,
          },
          contact,
        )
        if (result.stored) factsStored += 1
        if (result.applied) factsApplied += 1
      }
      notes.push(`observation_blocks=${observationBlocks.length}`)
    }

    // 3) Kind-specific internal pass (no invented external enrichment)
    if (contact) {
      if (task.kind === 'job_change_check' || task.kind === 'recheck_contact') {
        const proposedSnap = await adminDb
          .collection('contact_facts')
          .where('orgId', '==', task.orgId)
          .where('contactId', '==', contact.id)
          .where('status', '==', 'PROPOSED')
          .limit(50)
          .get()
        const open = proposedSnap.docs.filter((d) => d.data().deleted !== true).length
        notes.push(`open_proposals=${open}`)
      }

      if (task.kind === 'mailbox_identity' && !bodyText.trim()) {
        notes.push('mailbox_identity_without_body')
      }

      if (
        (task.kind === 'enrich_contact' || task.kind === 'enrich_company') &&
        factsStored === 0 &&
        !bodyText.trim() &&
        observationBlocks.length === 0
      ) {
        notes.push('no_payload_enrichment_skipped')
      }
    }

    const budgetSpentDelta = factsStored > 0 ? Math.min(task.budgetUnits || 1, Math.max(1, factsStored)) : 0
    const summaryParts = [
      `kind=${task.kind}`,
      `reason=${task.reason.slice(0, 180)}`,
      `stored=${factsStored}`,
      `applied=${factsApplied}`,
      ...notes,
    ]
    const resultSummary = summaryParts.join('; ').slice(0, 2000)

    if (contact) {
      await logResearchActivity({
        orgId: task.orgId,
        contactId: contact.id,
        companyId: task.companyId ?? (typeof contact.companyId === 'string' ? contact.companyId : null),
        task,
        summary: `Research worker: ${task.reason}`.slice(0, 500),
        workerId,
        factsStored,
        factsApplied,
      })
    }

    await completeResearchTask({
      orgId: task.orgId,
      taskId: task.id,
      resultSummary,
      budgetSpentDelta,
      failed: false,
    })

    return {
      taskId: task.id,
      orgId: task.orgId,
      ok: true,
      failed: false,
      resultSummary,
      budgetSpentDelta,
      factsStored,
      factsApplied,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'process_failed'
    try {
      await completeResearchTask({
        orgId: task.orgId,
        taskId: task.id,
        failed: true,
        error: message,
        resultSummary: `failed: ${message}`.slice(0, 2000),
        budgetSpentDelta: 0,
      })
    } catch (completeErr) {
      console.error('[research-worker] complete after failure failed', task.id, completeErr)
    }
    return {
      taskId: task.id,
      orgId: task.orgId,
      ok: false,
      failed: true,
      resultSummary: message,
      budgetSpentDelta: 0,
      factsStored,
      factsApplied,
      error: message,
    }
  }
}

/**
 * Org-scoped: lease next due task then process (Hermes multi-machine workers).
 */
export async function workNextResearchTaskForOrg(args: {
  orgId: string
  workerId: string
  leaseSeconds?: number
}): Promise<{ leased: false; task: null } | { leased: true; task: CrmResearchTask; result: ProcessResearchTaskResult }> {
  const task = await leaseNextResearchTask({
    orgId: args.orgId,
    workerId: args.workerId,
    leaseSeconds: args.leaseSeconds,
  })
  if (!task) return { leased: false, task: null }
  const result = await processLeasedResearchTask({ task, workerId: args.workerId })
  return { leased: true, task, result }
}

/**
 * Global batch runner for cron (cross-tenant, multi-machine safe).
 */
export async function runResearchTaskWorkerBatch(args: {
  workerId: string
  maxTasks?: number
  timeBudgetMs?: number
  leaseSeconds?: number
}): Promise<ResearchWorkerBatchResult> {
  const startedAt = Date.now()
  const maxTasks = Math.min(Math.max(args.maxTasks ?? 25, 1), 100)
  const timeBudgetMs = Math.min(Math.max(args.timeBudgetMs ?? 55_000, 1_000), 55_000)
  const workerId = String(args.workerId || 'crm-research-cron').trim().slice(0, 120)

  let processed = 0
  let succeeded = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []
  const results: ProcessResearchTaskResult[] = []

  // Prefer global walk; fall back path still multi-worker via transactional lease.
  const candidates = await listGlobalLeasableResearchTasks({ limit: maxTasks * 2 })
  if (candidates.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, errors: [], results: [] }
  }

  for (const candidate of candidates) {
    if (processed >= maxTasks) break
    if (Date.now() - startedAt > timeBudgetMs) break

    const leased = await leaseResearchTaskById({
      taskId: candidate.id,
      orgId: candidate.orgId,
      workerId,
      leaseSeconds: args.leaseSeconds,
    })
    if (!leased) {
      skipped += 1
      continue
    }

    const result = await processLeasedResearchTask({ task: leased, workerId })
    results.push(result)
    processed += 1
    if (result.failed || !result.ok) {
      failed += 1
      if (result.error) errors.push(`${result.taskId}: ${result.error}`)
    } else {
      succeeded += 1
    }
  }

  return { processed, succeeded, failed, skipped, errors, results }
}

/** Test helper — expose listLeasable for org-scoped unit tests without exporting Firestore quirks. */
export async function listOrgLeasableForWorker(orgId: string, limit = 20): Promise<CrmResearchTask[]> {
  return listLeasableResearchTasks({ orgId, limit })
}
