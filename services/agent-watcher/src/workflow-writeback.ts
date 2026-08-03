/**
 * Workflow Graph write-back from the agent-watcher.
 *
 * Watcher writes task terminal state directly to Firestore and never hits the
 * Next.js task PATCH route. Without this hook, agent/human graph nodes never
 * advance the WorkflowRun ledger after a live Hermes completion.
 *
 * Strategy (fail-closed, dual path):
 * 1. Always enqueue an outbox doc (cron + API reconcile even if HTTP is down).
 * 2. Best-effort HTTP POST to /api/v1/workflow-runs/{id} when PIB_API_BASE + AI_API_KEY are set.
 * 3. Never throw into the watcher completion path — log and rely on outbox.
 */
import type { DocumentReference } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { logger } from './logger'

export type WorkflowWritebackOutcome = 'done' | 'blocked' | 'awaiting_input' | 'rejected'

export type WorkflowWritebackInput = {
  taskRef: DocumentReference
  taskId: string
  taskData: Record<string, unknown>
  outcome: WorkflowWritebackOutcome
  summary?: string
  hermesRunId?: string | null
  telemetry?: unknown
  errorFamily?:
    | 'transient_infra'
    | 'verifier_fail'
    | 'agent_incomplete'
    | 'policy'
    | 'approval_denied'
    | 'budget'
    | 'capability'
    | 'invalid_spec'
    | 'unknown'
  actorUid?: string
}

export type WorkflowEvidenceItem = { type: string; ref: string; label?: string }

const OUTBOX = 'workflow_writeback_outbox'

export function extractWorkflowStamp(taskData: Record<string, unknown>): {
  runId: string
  nodeId: string
  orgId: string
} | null {
  const runId = typeof taskData.workflowRunId === 'string' ? taskData.workflowRunId.trim() : ''
  const nodeId = typeof taskData.workflowNodeId === 'string' ? taskData.workflowNodeId.trim() : ''
  if (!runId || !nodeId) return null
  const orgId = typeof taskData.orgId === 'string' ? taskData.orgId.trim() : ''
  return { runId, nodeId, orgId }
}

/** Firestore rejects `undefined` field values; drop them before set/merge. */
export function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value
  }
  return out as T
}

const PILOT_EVIDENCE_KEYS = [
  'research_doc_id',
  'draft_doc_id',
  'eng_checklist_id',
  'content_checklist_id',
  'approval_ref',
  'qa_probe_id',
  'publish_noop_receipt',
] as const

function pushUniqueEvidence(
  evidence: WorkflowEvidenceItem[],
  item: WorkflowEvidenceItem,
): void {
  if (!item.type || !item.ref) return
  if (evidence.some((e) => e.type === item.type && e.ref === item.ref)) return
  evidence.push(item)
}

function evidenceFromArtifactsArray(rawList: unknown): WorkflowEvidenceItem[] {
  const evidence: WorkflowEvidenceItem[] = []
  if (!Array.isArray(rawList)) return evidence
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue
    const artifact = raw as Record<string, unknown>
    const type =
      typeof artifact.type === 'string'
        ? artifact.type
        : typeof artifact.label === 'string'
          ? artifact.label
          : ''
    const ref = typeof artifact.ref === 'string' ? artifact.ref : ''
    if (!type || !ref) continue
    const item: WorkflowEvidenceItem = { type, ref }
    if (typeof artifact.label === 'string' && artifact.label.trim()) {
      item.label = artifact.label
    }
    pushUniqueEvidence(evidence, item)
  }
  return evidence
}

/**
 * Parse structured artifacts from free-text agent summaries.
 * Quinn/stub producers often put artifacts=[{type,ref}] in prose; watcher must not drop them.
 */
export function parseArtifactsFromText(text: unknown): WorkflowEvidenceItem[] {
  if (typeof text !== 'string' || !text.trim()) return []
  const evidence: WorkflowEvidenceItem[] = []

  // artifacts=[{type:research_doc_id, ref:stub_research_doc_id}] or JSON-ish
  const arrayMatch = text.match(/artifacts\s*[:=]\s*(\[[\s\S]*?\])/i)
  if (arrayMatch?.[1]) {
    const raw = arrayMatch[1]
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
      .replace(/'/g, '"')
    try {
      const parsed = JSON.parse(raw) as unknown
      for (const item of evidenceFromArtifactsArray(parsed)) pushUniqueEvidence(evidence, item)
    } catch {
      // fall through to looser patterns
    }
  }

  for (const m of text.matchAll(
    /\{\s*type\s*[:=]\s*["']?([a-zA-Z0-9_.-]+)["']?\s*,\s*ref\s*[:=]\s*["']([^"'}]+)["']\s*\}/g,
  )) {
    pushUniqueEvidence(evidence, { type: m[1], ref: m[2].trim() })
  }

  for (const key of PILOT_EVIDENCE_KEYS) {
    const re = new RegExp(`${key}\\s*[:=]\\s*["']?([a-zA-Z0-9_.:\\/-]+)`, 'i')
    const hit = text.match(re)
    if (hit?.[1]) pushUniqueEvidence(evidence, { type: key, ref: hit[1].trim() })
  }

  return evidence
}

/**
 * Build durable agentOutput.artifacts for task completion + graph write-back.
 * Prefer explicit structured fields; fall back to expectedArtifacts + summary parse.
 */
export function buildCompletionArtifacts(input: {
  agentOutput?: unknown
  summary?: string | null
  expectedArtifacts?: unknown
}): Array<{ type: string; ref: string; label?: string }> {
  const evidence: WorkflowEvidenceItem[] = []
  const output =
    input.agentOutput && typeof input.agentOutput === 'object'
      ? (input.agentOutput as Record<string, unknown>)
      : null

  if (output) {
    for (const item of extractEvidenceFromAgentOutput(output)) pushUniqueEvidence(evidence, item)
  }
  for (const item of parseArtifactsFromText(input.summary)) pushUniqueEvidence(evidence, item)
  if (output && typeof output.summary === 'string') {
    for (const item of parseArtifactsFromText(output.summary)) pushUniqueEvidence(evidence, item)
  }

  const expected = Array.isArray(input.expectedArtifacts)
    ? input.expectedArtifacts.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []

  // Golden stubs: if expected type is claimed in summary as stub_<type>, materialize it.
  for (const type of expected) {
    if (evidence.some((e) => e.type === type)) continue
    const stubRef = `stub_${type}`
    const blob = `${input.summary || ''} ${output && typeof output.summary === 'string' ? output.summary : ''}`
    if (blob.includes(stubRef) || /GOLDEN STUB/i.test(blob)) {
      pushUniqueEvidence(evidence, { type, ref: stubRef, label: `golden stub ${type}` })
    }
  }

  return evidence.map((item) => {
    const out: { type: string; ref: string; label?: string } = { type: item.type, ref: item.ref }
    if (item.label) out.label = item.label
    return out
  })
}

export function extractEvidenceFromAgentOutput(agentOutput: unknown): WorkflowEvidenceItem[] {
  const evidence: WorkflowEvidenceItem[] = []
  if (!agentOutput || typeof agentOutput !== 'object') return evidence
  const output = agentOutput as Record<string, unknown>

  for (const item of evidenceFromArtifactsArray(output.artifacts)) {
    pushUniqueEvidence(evidence, item)
  }

  for (const key of PILOT_EVIDENCE_KEYS) {
    const value = output[key]
    if (typeof value === 'string' && value.trim()) {
      pushUniqueEvidence(evidence, { type: key, ref: value.trim() })
    }
  }

  // Also parse summary prose so thrash-safe dual GET still sees typed proof after reopen.
  if (typeof output.summary === 'string') {
    for (const item of parseArtifactsFromText(output.summary)) {
      pushUniqueEvidence(evidence, item)
    }
  }

  return evidence
}

function apiBase(): string {
  return (process.env.PIB_API_BASE || process.env.PARTNERSINBIZ_API_BASE || 'https://partnersinbiz.online/api/v1')
    .replace(/\/$/, '')
}

function apiKey(): string {
  return (process.env.AI_API_KEY || process.env.PIB_AGENT_API_KEY || '').trim()
}

export async function notifyWorkflowGraphTerminal(input: WorkflowWritebackInput): Promise<void> {
  const stamp = extractWorkflowStamp(input.taskData)
  if (!stamp) return

  const now = new Date().toISOString()
  const agentOutput =
    input.taskData.agentOutput && typeof input.taskData.agentOutput === 'object'
      ? input.taskData.agentOutput
      : null
  const evidence = extractEvidenceFromAgentOutput(agentOutput)
  const telemetry =
    input.telemetry && typeof input.telemetry === 'object'
      ? (input.telemetry as Record<string, unknown>)
      : null
  const dedupeKey = [
    stamp.runId,
    stamp.nodeId,
    input.taskId,
    input.outcome,
    input.hermesRunId || 'norun',
  ].join(':')

  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined

  const payload = omitUndefined({
    dedupeKey,
    orgId: stamp.orgId || undefined,
    workflowRunId: stamp.runId,
    workflowNodeId: stamp.nodeId,
    kanbanTaskId: input.taskId,
    outcome: input.outcome,
    summary: input.summary,
    evidence,
    tokensIn: num(telemetry?.inputTokens),
    tokensOut: num(telemetry?.outputTokens),
    tokensTotal: num(telemetry?.totalTokens),
    estimatedCost: num(telemetry?.costUsd),
    model: str(telemetry?.model),
    provider: str(telemetry?.provider),
    hermesRunId: input.hermesRunId || undefined,
    errorFamily: input.errorFamily,
    actorUid: input.actorUid || 'agent-watcher',
    taskPath: input.taskRef.path,
    status: 'pending' as const,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    source: 'agent-watcher',
  })

  try {
    const ref = db.collection(OUTBOX).doc(dedupeKey.replace(/[^a-zA-Z0-9:_-]/g, '_'))
    const existing = await ref.get()
    if (!existing.exists) {
      await ref.set(payload)
    } else {
      await ref.set(
        omitUndefined({
          ...payload,
          createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          status: existing.data()?.status === 'applied' ? 'applied' : 'pending',
        }),
        { merge: true },
      )
    }
  } catch (err) {
    logger.error('workflow writeback outbox failed', {
      taskId: input.taskId,
      runId: stamp.runId,
      nodeId: stamp.nodeId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const key = apiKey()
  if (!key) {
    logger.info('workflow writeback queued (no AI_API_KEY for live HTTP)', {
      taskId: input.taskId,
      runId: stamp.runId,
      nodeId: stamp.nodeId,
      outcome: input.outcome,
    })
    return
  }

  try {
    const url = `${apiBase()}/workflow-runs/${encodeURIComponent(stamp.runId)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(stamp.orgId ? { 'X-Org-Id': stamp.orgId } : {}),
      },
      body: JSON.stringify({
        action: 'kanban_terminal',
        now,
        nodeId: stamp.nodeId,
        kanbanTaskId: input.taskId,
        outcome: input.outcome,
        evidence,
        summary: input.summary,
        tokensIn: payload.tokensIn,
        tokensOut: payload.tokensOut,
        tokensTotal: payload.tokensTotal,
        estimatedCost: payload.estimatedCost,
        model: payload.model,
        provider: payload.provider,
        hermesRunId: payload.hermesRunId,
        errorFamily: payload.errorFamily,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.warn('workflow writeback HTTP non-ok (outbox retained)', {
        taskId: input.taskId,
        runId: stamp.runId,
        status: res.status,
        body: text.slice(0, 400),
      })
      return
    }
    try {
      await db.collection(OUTBOX).doc(dedupeKey.replace(/[^a-zA-Z0-9:_-]/g, '_')).set(
        {
          status: 'applied',
          appliedAt: FieldValue.serverTimestamp(),
          appliedVia: 'http',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    } catch {
      // ignore outbox mark failure after successful advance
    }
    logger.info('workflow writeback applied via HTTP', {
      taskId: input.taskId,
      runId: stamp.runId,
      nodeId: stamp.nodeId,
      outcome: input.outcome,
    })
  } catch (err) {
    logger.warn('workflow writeback HTTP failed (outbox retained)', {
      taskId: input.taskId,
      runId: stamp.runId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
