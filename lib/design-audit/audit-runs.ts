/**
 * Design Audit runs store — org-scoped Firestore persistence for the
 * user-facing "audit our page" flow (T2, project 2ZybgdBFW3un2Rt6pq0Y).
 *
 * Each run records the audited URL, the T1 engine result (findings grouped
 * P0-P3 with element refs), and a waiver list ("Ignore + reason" records).
 * Every access is scoped by orgId; routes resolve the org from the
 * authenticated user + X-Org-Id, never from an unauthenticated body field.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

import { adminDb } from '@/lib/firebase/admin'
import type { AuditResult, Finding, Severity } from './types'

export const DESIGN_AUDIT_RUNS_COLLECTION = 'design_audit_runs'

export interface DesignAuditWaiver {
  id: string
  rule: string
  ref: string
  reason: string
  createdBy?: string
  createdAtMs: number
}

export interface DesignAuditRun {
  id: string
  orgId: string
  url: string
  scope: string
  /** `done` when the engine produced a result, `failed` on fetch/engine error. */
  status: 'done' | 'failed'
  exitCode: 0 | 1 | 2 | null
  summary: { total: number; bySeverity: Record<Severity, number>; byScope: Record<string, number> } | null
  findings: Finding[]
  notes: string[]
  errors: string[]
  designSystemPresent: boolean
  screenshotUrl?: string
  waivers: DesignAuditWaiver[]
  createdBy?: string
  createdAtMs: number
  updatedAtMs: number
  error?: string
}

export interface CreateDesignAuditRunInput {
  orgId: string
  url: string
  scope: string
  result: AuditResult
  screenshotUrl?: string
  createdBy?: string
  nowMs?: number
}

export interface DesignAuditRunRow extends Omit<DesignAuditRun, 'summary'> {
  summary: DesignAuditRun['summary'] | Record<string, unknown>
  findings: Finding[]
  notes: string[]
  errors: string[]
  waivers: DesignAuditWaiver[]
}

function runDoc(runId: string) {
  return adminDb.collection(DESIGN_AUDIT_RUNS_COLLECTION).doc(runId)
}

function toStored(run: DesignAuditRun): Record<string, unknown> {
  return {
    orgId: run.orgId,
    url: run.url,
    scope: run.scope,
    status: run.status,
    exitCode: run.exitCode,
    summary: run.summary,
    findings: run.findings,
    notes: run.notes,
    errors: run.errors,
    designSystemPresent: run.designSystemPresent,
    ...(run.screenshotUrl ? { screenshotUrl: run.screenshotUrl } : {}),
    waivers: run.waivers,
    ...(run.createdBy ? { createdBy: run.createdBy } : {}),
    createdAtMs: run.createdAtMs,
    updatedAtMs: run.updatedAtMs,
    ...(run.error ? { error: run.error } : {}),
  }
}

function fromStored(id: string, data: Record<string, unknown>): DesignAuditRun {
  const summaryRaw = data.summary
  const summary = summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)
    ? summaryRaw as DesignAuditRun['summary']
    : null
  return {
    id,
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    url: typeof data.url === 'string' ? data.url : '',
    scope: typeof data.scope === 'string' ? data.scope : 'all',
    status: data.status === 'failed' ? 'failed' : 'done',
    exitCode: data.exitCode === 0 || data.exitCode === 1 || data.exitCode === 2 ? data.exitCode : null,
    summary,
    findings: Array.isArray(data.findings) ? data.findings as Finding[] : [],
    notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
    errors: Array.isArray(data.errors) ? data.errors.map(String) : [],
    designSystemPresent: data.designSystemPresent === true,
    ...(typeof data.screenshotUrl === 'string' ? { screenshotUrl: data.screenshotUrl } : {}),
    waivers: Array.isArray(data.waivers) ? data.waivers as DesignAuditWaiver[] : [],
    ...(typeof data.createdBy === 'string' ? { createdBy: data.createdBy } : {}),
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
    updatedAtMs: typeof data.updatedAtMs === 'number' ? data.updatedAtMs : 0,
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
  }
}

export function generateDesignAuditRunId(): string {
  return `dar_${randomBytes(16).toString('base64url')}`
}

/** Persists a new audit run. The caller resolves orgId from auth (X-Org-Id). */
export async function createDesignAuditRun(input: CreateDesignAuditRunInput): Promise<DesignAuditRun> {
  const nowMs = input.nowMs ?? Date.now()
  const run: DesignAuditRun = {
    id: generateDesignAuditRunId(),
    orgId: input.orgId,
    url: input.url,
    scope: input.scope,
    status: input.result.errors.length ? 'failed' : 'done',
    exitCode: input.result.exitCode,
    summary: input.result.summary,
    findings: input.result.findings,
    notes: input.result.notes,
    errors: input.result.errors,
    designSystemPresent: input.result.designSystem.present,
    ...(input.screenshotUrl ? { screenshotUrl: input.screenshotUrl } : {}),
    waivers: [],
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  await runDoc(run.id).set(toStored(run))
  return run
}

/** Reads a run scoped to orgId. Returns null when missing or org-mismatched. */
export async function getDesignAuditRun(orgId: string, runId: string): Promise<DesignAuditRun | null> {
  if (!runId || !orgId) return null
  const snap = await runDoc(runId).get()
  if (!snap.exists) return null
  const run = fromStored(snap.id, snap.data() ?? {})
  if (run.orgId !== orgId) return null
  return run
}

export interface RecordDesignAuditWaiverInput {
  orgId: string
  runId: string
  rule: string
  ref: string
  reason: string
  createdBy?: string
  nowMs?: number
}

/** Records an "Ignore + reason" waiver on an existing run. */
export async function recordDesignAuditWaiver(input: RecordDesignAuditWaiverInput): Promise<DesignAuditRun | null> {
  const existing = await getDesignAuditRun(input.orgId, input.runId)
  if (!existing) return null
  const waiver: DesignAuditWaiver = {
    id: `w_${input.nowMs ?? Date.now()}_${existing.waivers.length}`,
    rule: input.rule,
    ref: input.ref,
    reason: input.reason,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    createdAtMs: input.nowMs ?? Date.now(),
  }
  const next: DesignAuditRun = {
    ...existing,
    waivers: [...existing.waivers, waiver],
    updatedAtMs: input.nowMs ?? Date.now(),
  }
  await runDoc(existing.id).update({
    waivers: next.waivers,
    updatedAtMs: next.updatedAtMs,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return next
}

export interface ReplaceDesignAuditRunResultInput {
  orgId: string
  runId: string
  result: AuditResult
  nowMs?: number
}

/**
 * Replaces an existing run's engine result (Re-run action). Findings and
 * waivers are preserved across re-runs unless the finding disappears — the
 * waiver list is kept as-is so an "Ignore" stays recorded.
 */
export async function replaceDesignAuditRunResult(input: ReplaceDesignAuditRunResultInput): Promise<DesignAuditRun | null> {
  const existing = await getDesignAuditRun(input.orgId, input.runId)
  if (!existing) return null
  const next: DesignAuditRun = {
    ...existing,
    status: input.result.errors.length ? 'failed' : 'done',
    exitCode: input.result.exitCode,
    summary: input.result.summary,
    findings: input.result.findings,
    notes: input.result.notes,
    errors: input.result.errors,
    designSystemPresent: input.result.designSystem.present,
    updatedAtMs: input.nowMs ?? Date.now(),
  }
  await runDoc(existing.id).update(toStored(next))
  return next
}

/** Lists the most recent runs for an org (descending by createdAtMs). */
export async function listDesignAuditRuns(orgId: string, limit = 20): Promise<DesignAuditRun[]> {
  const snap = await adminDb
    .collection(DESIGN_AUDIT_RUNS_COLLECTION)
    .where('orgId', '==', orgId)
    .orderBy('createdAtMs', 'desc')
    .limit(limit)
    .get()
  return snap.docs.map((doc) => fromStored(doc.id, doc.data() ?? {}))
}
