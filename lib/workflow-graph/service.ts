import { createHash, randomUUID } from 'node:crypto'
import {
  advanceWorkflowRun,
  bindKanbanTask,
  createWorkflowRunFromTemplate,
  inspectWorkflowRun,
} from './engine'
import {
  applyStuckEvaluation,
  buildBlockAlertFact,
  buildOpsInspect,
  buildQuietSuccessFact,
  bumpBlockRevisionOnAlertTransition,
  classifyOpsRunBucket,
  shouldEmitBlockAlert,
  shouldEmitQuietSuccess,
} from './ops'
import {
  findWorkflowRunByIdempotencyKey,
  getGraphTemplate,
  getWorkflowRun,
  listOpsFacts,
  listWorkflowRuns,
  materializeKanbanTask,
  saveGraphTemplate,
  saveOpsFact,
  saveWorkflowRun,
} from './store'
import { buildPilotResearchValidateDocApproveFanoutTemplate } from './pilot'
import { promotePlaybookTemplateToGraphTemplate } from './playbook-promote'
import { normalizeGraphTemplate, runCreateIdempotencyKey, validateGraphTemplate } from './validation'
import type { AdvanceEvent, GraphTemplate, WorkflowApprovalRef, WorkflowRun } from './types'
import type { ProjectPlaybookTemplateV1 } from '@/lib/projects/playbooks'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { OpsListItem } from './ops'

export async function ensurePilotTemplate(orgId: string, projectId?: string, actorUid = 'system'): Promise<GraphTemplate> {
  const existing = await adminDb
    .collection('graph_templates')
    .where('orgId', '==', orgId)
    .where('name', '==', 'pilot-research-validate-doc-approve-fanout')
    .limit(1)
    .get()
    .catch(() => null)

  if (existing && !existing.empty) {
    return { id: existing.docs[0].id, ...(existing.docs[0].data() as GraphTemplate) }
  }

  const template = buildPilotResearchValidateDocApproveFanoutTemplate({ orgId, projectId })
  return saveGraphTemplate(template, actorUid)
}

export async function createOrUpdateGraphTemplate(
  body: unknown,
  actorUid: string,
  orgId: string,
): Promise<{ ok: true; template: GraphTemplate } | { ok: false; error: string; status: number }> {
  const normalized = normalizeGraphTemplate(body, { orgId })
  if (!normalized.orgId) normalized.orgId = orgId
  const validated = validateGraphTemplate(normalized)
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 }
  const saved = await saveGraphTemplate(validated.template, actorUid)
  return { ok: true, template: saved }
}

/**
 * Shared ops side-effects for advance path AND stuck SLA cron.
 * Applies stuck evaluation, bumps blockRevision on alert transitions,
 * and writes one deduped workflow_ops_facts row (alert-on-block / quiet success).
 */
export async function finalizeOpsSideEffects(
  previous: WorkflowRun | null,
  run: WorkflowRun,
  now: string,
): Promise<WorkflowRun> {
  let next = applyStuckEvaluation(run, now)
  if (previous) {
    next = bumpBlockRevisionOnAlertTransition(previous, next)
  } else if (shouldEmitBlockAlert(next) && !next.blockRevision) {
    next = { ...next, blockRevision: 1 }
  }

  if (shouldEmitBlockAlert(next)) {
    const fact = buildBlockAlertFact(next, now)
    if (next.lastAlertDedupeKey !== fact.dedupeKey) {
      const saved = await saveOpsFact(fact).catch(() => ({ written: false as const, fact }))
      if (saved.written || saved.fact) {
        next = { ...next, lastAlertDedupeKey: fact.dedupeKey }
      }
    }
  } else if (shouldEmitQuietSuccess(next)) {
    await saveOpsFact(buildQuietSuccessFact(next, now)).catch(() => null)
  }

  return next
}

export async function startWorkflowRun(input: {
  orgId: string
  templateId: string
  projectId?: string
  actorUid: string
  trigger?: { type: string; ref?: string }
  idempotencyKey?: string
  approvalRefs?: WorkflowApprovalRef[]
}): Promise<{ ok: true; run: WorkflowRun; inspect: ReturnType<typeof buildOpsInspect>; deduplicated?: boolean } | { ok: false; error: string; status: number }> {
  const template = await getGraphTemplate(input.templateId)
  if (!template) return { ok: false, error: 'Graph template not found', status: 404 }
  if (template.orgId !== input.orgId) return { ok: false, error: 'Forbidden template org', status: 403 }
  if (template.status === 'archived') return { ok: false, error: 'Template is archived', status: 409 }
  if (template.status === 'draft') return { ok: false, error: 'Template must be active', status: 409 }

  const projectId = input.projectId || template.projectId
  if (!projectId) return { ok: false, error: 'projectId is required to materialize agent/human_gate nodes', status: 400 }

  const now = new Date().toISOString()
  const createKey = input.idempotencyKey || runCreateIdempotencyKey({
    orgId: input.orgId,
    templateId: input.templateId,
    triggerRef: input.trigger?.ref,
  })

  const existing = await findWorkflowRunByIdempotencyKey(input.orgId, createKey).catch(() => null)
  if (existing) {
    return { ok: true, run: existing, inspect: buildOpsInspect(existing), deduplicated: true }
  }

  const runId = `wfr_${createHash('sha256').update(`${createKey}:${randomUUID()}`).digest('hex').slice(0, 24)}`
  let run = createWorkflowRunFromTemplate({
    runId,
    template: { ...template, id: template.id || input.templateId },
    orgId: input.orgId,
    projectId,
    trigger: {
      type: input.trigger?.type || 'manual',
      ref: input.trigger?.ref,
      at: now,
    },
    createdBy: input.actorUid,
    now,
    approvalRefs: input.approvalRefs,
  })
  run.createIdempotencyKey = createKey

  run = await applyAdvanceAndMaterialize(run, {
    type: 'tick',
    now,
  }, input.actorUid)

  await saveWorkflowRun(run)
  return { ok: true, run, inspect: buildOpsInspect(run) }
}

export async function applyAdvanceAndMaterialize(
  run: WorkflowRun,
  event: AdvanceEvent,
  actorUid: string,
): Promise<WorkflowRun> {
  let current = run
  for (let i = 0; i < 20; i += 1) {
    const result = advanceWorkflowRun(current, i === 0 ? event : { type: 'tick', now: event.now })
    current = result.run

    if (!result.materialize.length) break
    const projectId = current.projectId
    if (!projectId) break

    let boundAny = false
    for (const intent of result.materialize) {
      const node = current.nodes.find((item) => item.nodeId === intent.nodeId)
      if (node?.kanbanTaskId) continue
      const materialized = await materializeKanbanTask({
        projectId,
        orgId: current.orgId,
        run: current,
        intent,
        actorUid,
      })
      if (!materialized.ok) {
        const failed = advanceWorkflowRun(current, {
          type: 'kanban_terminal',
          now: event.now,
          nodeId: intent.nodeId,
          kanbanTaskId: 'materialize-failed',
          outcome: 'blocked',
          errorFamily: 'policy',
          summary: materialized.error,
        })
        current = failed.run
        continue
      }
      current = bindKanbanTask(current, intent.nodeId, materialized.taskId, event.now)
      boundAny = true
    }
    if (!boundAny) break
  }

  current = await finalizeOpsSideEffects(run, current, event.now)
  await saveWorkflowRun(current)
  return current
}

export async function advanceWorkflowRunById(
  runId: string,
  event: AdvanceEvent,
  actorUid: string,
): Promise<{ ok: true; run: WorkflowRun; inspect: ReturnType<typeof buildOpsInspect> } | { ok: false; error: string; status: number }> {
  const existing = await getWorkflowRun(runId)
  if (!existing) return { ok: false, error: 'Workflow run not found', status: 404 }
  const run = await applyAdvanceAndMaterialize(existing, event, actorUid)
  return { ok: true, run, inspect: buildOpsInspect(run) }
}

export async function cancelWorkflowRun(
  runId: string,
  actorUid: string,
  reason: string,
): Promise<{ ok: true; run: WorkflowRun; inspect: ReturnType<typeof buildOpsInspect> } | { ok: false; error: string; status: number }> {
  return advanceWorkflowRunById(runId, {
    type: 'cancel',
    now: new Date().toISOString(),
    reason,
  }, actorUid)
}

export async function handleKanbanTaskTerminalForWorkflow(input: {
  task: Record<string, unknown>
  outcome: 'done' | 'blocked' | 'awaiting_input' | 'rejected'
  evidence?: Array<{ type: string; ref: string; label?: string }>
  summary?: string
  tokensIn?: number
  tokensOut?: number
  tokensTotal?: number
  estimatedCost?: number
  model?: string
  provider?: string
  hermesRunId?: string
  errorFamily?: 'transient_infra' | 'verifier_fail' | 'agent_incomplete' | 'policy' | 'approval_denied' | 'budget' | 'capability' | 'invalid_spec' | 'unknown'
  actorUid: string
}): Promise<void> {
  const runId = typeof input.task.workflowRunId === 'string' ? input.task.workflowRunId : ''
  const nodeId = typeof input.task.workflowNodeId === 'string' ? input.task.workflowNodeId : ''
  const taskId = typeof input.task.id === 'string' ? input.task.id : ''
  if (!runId || !nodeId || !taskId) return

  const now = new Date().toISOString()
  const evidence = (input.evidence ?? []).map((item) => ({ ...item, at: now }))

  const agentOutput = input.task.agentOutput && typeof input.task.agentOutput === 'object'
    ? input.task.agentOutput as Record<string, unknown>
    : null
  if (agentOutput && Array.isArray(agentOutput.artifacts)) {
    for (const raw of agentOutput.artifacts) {
      if (!raw || typeof raw !== 'object') continue
      const artifact = raw as Record<string, unknown>
      const type = typeof artifact.type === 'string' ? artifact.type : typeof artifact.label === 'string' ? artifact.label : ''
      const ref = typeof artifact.ref === 'string' ? artifact.ref : ''
      if (type && ref) evidence.push({ type, ref, label: typeof artifact.label === 'string' ? artifact.label : undefined, at: now })
    }
  }

  if (agentOutput) {
    for (const key of ['research_doc_id', 'draft_doc_id', 'eng_checklist_id', 'content_checklist_id', 'approval_ref']) {
      const value = agentOutput[key]
      if (typeof value === 'string' && value.trim()) {
        evidence.push({ type: key, ref: value.trim(), at: now })
      }
    }
  }

  await advanceWorkflowRunById(runId, {
    type: 'kanban_terminal',
    now,
    nodeId,
    kanbanTaskId: taskId,
    outcome: input.outcome,
    evidence,
    summary: input.summary,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    tokensTotal: input.tokensTotal,
    estimatedCost: input.estimatedCost,
    model: input.model,
    provider: input.provider,
    hermesRunId: input.hermesRunId,
    errorFamily: input.errorFamily,
  }, input.actorUid)
}

export async function startRunFromPlaybook(input: {
  orgId: string
  projectId: string
  playbookId: string
  playbookName: string
  playbookTemplate: ProjectPlaybookTemplateV1
  actorUid: string
  idempotencyKey?: string
}): Promise<{ ok: true; run: WorkflowRun; template: GraphTemplate; inspect: ReturnType<typeof buildOpsInspect> } | { ok: false; error: string; status: number }> {
  const promoted = promotePlaybookTemplateToGraphTemplate({
    orgId: input.orgId,
    name: `playbook:${input.playbookName}`,
    playbookId: input.playbookId,
    playbookTemplate: input.playbookTemplate,
    projectId: input.projectId,
    status: 'active',
  })
  if (!promoted.ok) return { ok: false, error: promoted.error, status: 400 }

  const savedTemplate = await saveGraphTemplate(promoted.template, input.actorUid)
  const started = await startWorkflowRun({
    orgId: input.orgId,
    templateId: savedTemplate.id!,
    projectId: input.projectId,
    actorUid: input.actorUid,
    trigger: { type: 'playbook', ref: input.playbookId },
    idempotencyKey: input.idempotencyKey,
  })
  if (!started.ok) return started
  return { ok: true, run: started.run, template: savedTemplate, inspect: started.inspect }
}

export async function markPlaybookExecutionBackend(
  projectId: string,
  playbookId: string,
  backend: 'playbook' | 'workflow_graph',
): Promise<void> {
  await adminDb.collection('projects').doc(projectId).collection('playbooks').doc(playbookId).set({
    executionBackend: backend,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export async function listOpsWorkflowRuns(input: {
  orgId: string
  status?: string
  limit?: number
  now?: string
}): Promise<{
  items: OpsListItem[]
  facts: Awaited<ReturnType<typeof listOpsFacts>>
  counts: { stuck: number; blocked: number; paused_budget: number }
}> {
  const now = input.now || new Date().toISOString()
  const status = input.status
  const runs = await listWorkflowRuns({
    orgId: input.orgId,
    status: status === 'stuck' || status === 'blocked' ? undefined : status,
    limit: input.limit ?? 50,
  })

  const items: OpsListItem[] = []
  const counts = { stuck: 0, blocked: 0, paused_budget: 0 }

  for (const run of runs) {
    const evaluated = applyStuckEvaluation(run, now)
    const bucket = classifyOpsRunBucket(evaluated, now)
    if (bucket === 'stuck') counts.stuck += 1
    if (bucket === 'blocked') counts.blocked += 1
    if (bucket === 'paused_budget') counts.paused_budget += 1

    if (status === 'stuck' && bucket !== 'stuck') continue
    if (status === 'blocked' && bucket !== 'blocked') continue
    if ((status === 'paused_budget' || status === 'paused') && bucket !== 'paused_budget') continue

    items.push({
      runId: evaluated.id,
      orgId: evaluated.orgId,
      templateId: evaluated.templateId,
      projectId: evaluated.projectId,
      status: evaluated.status,
      bucket,
      blockedReasonCode: evaluated.blockedReasonCode,
      stuckReasonCode: evaluated.stuckReasonCode,
      stuckAt: evaluated.stuckAt,
      costTokensTotal: evaluated.cost.tokensTotal,
      budgetStatus: evaluated.cost.budgetStatus,
      updatedAt: evaluated.updatedAt,
      deepLink: evaluated.id ? `/api/v1/workflow-runs/${evaluated.id}` : undefined,
    })
  }

  const facts = await listOpsFacts(input.orgId, 30).catch(() => [])
  return { items, facts, counts }
}

export { inspectWorkflowRun, buildOpsInspect }
