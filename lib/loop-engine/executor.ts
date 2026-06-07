import { approvalGatesForAction, approvalGatesForCapability, isActionExecutableWithoutApproval, modeForAction, type LoopActionProposal } from './actions'
import { getLoopById, type LoopApprovalGate, type LoopRegistryEntry, type LoopRiskLevel } from './registry'
import { evidenceRequirementsForRisk, explainTaskLoopReadiness, type LoopTaskReadinessInput } from './readiness'
import { buildLoopRunId, deriveLoopRunStatus, type LoopRunCandidate, type LoopRunEvidence, type LoopRunRecord, type LoopRunTrigger } from './runs'

type EvaluateLoopRunInput = {
  loopId: string
  orgId: string
  trigger?: LoopRunTrigger
  candidates?: LoopRunCandidate[]
  dryRun?: boolean
  createdBy?: string
  createdByType?: 'system' | 'agent' | 'user'
  now?: Date
  idempotencyKey?: string
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function asRisk(value: unknown, fallback: LoopRiskLevel): LoopRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical' ? value : fallback
}

function candidateTask(candidate: LoopRunCandidate): LoopTaskReadinessInput {
  return {
    ...(candidate.task ?? {}),
    id: candidate.taskId ?? candidate.id,
    title: candidate.title,
    riskLevel: candidate.riskLevel,
    requiredCapability: candidate.requiredCapability,
    approvalGateTaskId: candidate.approvalGateTaskId,
    approvalGateStatus: candidate.approvalGateStatus,
  }
}

function gateSummary(loop: LoopRegistryEntry, candidate: LoopRunCandidate): LoopApprovalGate[] {
  return unique([
    ...loop.approvalGates,
    ...approvalGatesForCapability(candidate.requiredCapability),
  ])
}

function proposedActionsForCandidate(loop: LoopRegistryEntry, candidate: LoopRunCandidate): LoopActionProposal[] {
  const riskLevel = asRisk(candidate.riskLevel, loop.riskLevel)
  const gates = gateSummary(loop, candidate)
  const evidence = evidenceRequirementsForRisk(riskLevel)

  if (loop.id === 'lead-response') {
    return [
      {
        id: `${candidate.id}:lead-task`,
        kind: 'task-create',
        label: 'Create internal lead-response task',
        summary: 'Create an internal owner/review task with lead source, duplicate check, and next-step recommendation.',
        targetType: 'task',
        targetId: candidate.taskId ?? null,
        mode: 'safe-auto',
        approvalGates: [],
        evidenceRequired: ['Lead source', 'Duplicate/suppression check', 'Owner or reviewer'],
        payload: { internalOnly: true, candidateId: candidate.id, projectId: candidate.projectId ?? null },
      },
      {
        id: `${candidate.id}:lead-draft`,
        kind: 'message-draft',
        label: 'Draft lead response for approval',
        summary: 'Prepare a prospect/client-visible response draft, but do not send or enroll without approval.',
        targetType: 'message',
        targetId: candidate.id,
        mode: 'draft-only',
        approvalGates: unique([...approvalGatesForAction('message-draft'), ...gates]),
        evidenceRequired: ['Draft copy', 'Approval before send', 'Suppression/duplicate evidence'],
        payload: { noExternalSend: true, candidateId: candidate.id },
      },
    ]
  }

  if (loop.id === 'seo-to-crm-acquisition') {
    return [
      {
        id: `${candidate.id}:seo-readiness`,
        kind: 'report',
        label: 'Create SEO-to-CRM opportunity readiness report',
        summary: 'Score the commercial opportunity and list missing attribution evidence before CRM execution.',
        targetType: 'report',
        targetId: candidate.id,
        mode: 'draft-only',
        approvalGates: gates,
        evidenceRequired: ['Page/keyword/source link', 'CRM/deal link or missing-evidence note', 'Pipeline hypothesis'],
        payload: { readinessOnly: true, candidateId: candidate.id },
      },
    ]
  }

  if (loop.id === 'dependency-release') {
    return [
      {
        id: `${candidate.id}:release`,
        kind: 'task-release',
        label: 'Release dependency-cleared internal task',
        summary: 'Move only sequencing-only internal work toward watcher eligibility when all dependencies are resolved.',
        targetType: 'task',
        targetId: candidate.taskId ?? candidate.id,
        mode: modeForAction('task-release', riskLevel, gates),
        approvalGates: gates,
        evidenceRequired: evidence,
        payload: { dependencyRelease: true, candidateId: candidate.id },
      },
    ]
  }

  if (loop.id === 'review-pileup') {
    return [
      {
        id: `${candidate.id}:review-route`,
        kind: 'task-review',
        label: 'Route stale review item',
        summary: 'Surface the review item to the reviewer without marking it approved/final done.',
        targetType: 'task',
        targetId: candidate.taskId ?? candidate.id,
        mode: 'safe-auto',
        approvalGates: [],
        evidenceRequired: ['Review item id', 'Reviewer', 'Oldest pending age or priority'],
        payload: { reviewOnly: true, candidateId: candidate.id },
      },
    ]
  }

  return [
    {
      id: `${candidate.id}:report`,
      kind: 'report',
      label: 'Record loop decision report',
      summary: 'Record the loop decision, blockers, and next owner without side effects.',
      targetType: 'loop-run',
      targetId: candidate.id,
      mode: modeForAction('report', riskLevel, gates),
      approvalGates: gates,
      evidenceRequired: evidence,
      payload: { candidateId: candidate.id },
    },
  ]
}

function runEvidence(candidate: LoopRunCandidate, eligible: boolean): LoopRunEvidence[] {
  return [
    {
      type: 'source',
      label: candidate.type,
      ref: candidate.taskId ?? candidate.id,
      summary: candidate.title,
    },
    {
      type: eligible ? 'readiness' : 'blocker',
      label: eligible ? 'Candidate eligible' : 'Candidate blocked',
      ref: candidate.taskId ?? candidate.id,
      summary: eligible ? 'The candidate passed loop readiness checks.' : 'The candidate did not pass loop readiness checks.',
    },
  ]
}

export function evaluateLoopRun(input: EvaluateLoopRunInput): LoopRunRecord {
  const loop = getLoopById(input.loopId)
  if (!loop) throw new Error(`Unknown loopId ${input.loopId}`)

  const now = input.now ?? new Date()
  const dryRun = input.dryRun ?? true
  const candidates = input.candidates ?? []
  const idempotencyKey = input.idempotencyKey ?? `${input.orgId}:${loop.id}:${input.trigger?.ref ?? 'manual'}:${now.toISOString().slice(0, 10)}`
  const readinessResults = candidates.map((candidate) => ({
    candidateId: candidate.id,
    ...explainTaskLoopReadiness(candidateTask(candidate), { now }),
  }))
  const eligibleCandidateIds = new Set(readinessResults.filter((result) => result.eligible).map((result) => result.candidateId))
  const proposedActions = candidates
    .filter((candidate) => eligibleCandidateIds.has(candidate.id) || candidate.type === 'lead' || candidate.type === 'seo-signal' || candidate.type === 'review-item')
    .flatMap((candidate) => proposedActionsForCandidate(loop, candidate))
  const executableActions = proposedActions.filter(isActionExecutableWithoutApproval)
  const executedActions = dryRun ? [] : executableActions
  const blocked = candidates.length > 0 && proposedActions.length === 0
  const approvalGates = unique(proposedActions.flatMap((action) => action.approvalGates))
  const evidence = candidates.flatMap((candidate) => runEvidence(candidate, eligibleCandidateIds.has(candidate.id)))
  const status = deriveLoopRunStatus({ dryRun, proposedActions, executedActions, blocked })
  const candidateSummary = candidates.length === 0
    ? 'No loop candidates were supplied for this evaluation.'
    : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} evaluated; ${proposedActions.length} proposed action${proposedActions.length === 1 ? '' : 's'}.`
  const decision = status === 'awaiting_approval'
    ? 'The loop found work, but one or more proposed actions require approval before execution.'
    : status === 'blocked'
      ? 'The loop found candidates but did not produce an executable or proposal-ready action.'
      : dryRun
        ? 'The loop produced a dry-run proposal only; no side effects were performed.'
        : 'The loop executed only safe internal actions; gated side effects remain blocked.'

  return {
    id: buildLoopRunId(loop, idempotencyKey),
    loopId: loop.id,
    loopName: loop.name,
    orgId: input.orgId,
    status,
    dryRun,
    riskLevel: loop.riskLevel,
    ownerAgentId: loop.ownerAgentId,
    reviewerAgentId: loop.reviewerAgentId,
    trigger: input.trigger ?? { kind: loop.trigger.kind, source: 'manual' },
    candidateSummary,
    candidates,
    readinessResults,
    proposedActions,
    executedActions,
    approvalGates,
    evidence,
    decision,
    createdByType: input.createdByType ?? 'agent',
    createdBy: input.createdBy ?? 'pip',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    idempotencyKey,
  }
}
