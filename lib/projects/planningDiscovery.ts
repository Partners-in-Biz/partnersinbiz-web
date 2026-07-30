import { createHash } from 'node:crypto'

export const PLAN_WITH_ASSUMPTIONS_ATTESTATION = 'PLAN WITH ASSUMPTIONS'
export const PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD = 95

export type PlanningDecisionBrief = {
  outcome: string
  user: string
  whyNow: string
  successCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  assumptions: string[]
  risks: string[]
  approvalGates: string[]
}

export type PlanningInspectionEvidence = {
  brief: string[]
  docs: string[]
  files: string[]
  plan: string[]
  tasks: string[]
  tools: string[]
  agents: string[]
  skills: string[]
  inspectedBy: string
  inspectedAt: string
}

export type PlanningInspectionInput = Omit<PlanningInspectionEvidence, 'inspectedBy' | 'inspectedAt'>

export type PlanningInterviewTurn = {
  id: string
  question: string
  currentGuess: string
  askedBy: string
  askedAt: string
  answer?: string
  answeredBy?: string
  answeredAt?: string
}

export type PlanningDiscoverySnapshot = {
  revision: number
  status: PlanningDiscoveryState['status']
  mode: PlanningDiscoveryState['mode']
  confidence?: number
  brief: PlanningDecisionBrief
  digest: string
  confirmedBy?: string
  confirmedAt?: string
  staleReason: string
  staleAt: string
  staleBy: string
}

export type PlanningDiscoveryState = {
  schemaVersion: 1
  revision: number
  status: 'interviewing' | 'brief_ready' | 'confirmed' | 'assumptions_attested'
  mode: 'interview' | 'assumptions'
  enforced: true
  inspection?: PlanningInspectionEvidence
  turns?: PlanningInterviewTurn[]
  pendingQuestionId?: string
  predictedNextAnswers?: string[]
  intentBlockingUnknowns?: string[]
  confidence?: number
  brief?: PlanningDecisionBrief
  digest?: string
  snapshots?: PlanningDiscoverySnapshot[]
  startedBy?: string
  startedAt?: string
  updatedBy?: string
  updatedAt?: string
  confirmedBy?: string
  confirmedAt?: string
  attestation?: typeof PLAN_WITH_ASSUMPTIONS_ATTESTATION
  attestationReason?: string
  acknowledgesPreservedOperationalGates?: true
}

export type PlanningAction =
  | { type: 'start'; expectedRevision?: number }
  | { type: 'record_inspection'; expectedRevision: number; evidence: PlanningInspectionInput }
  | { type: 'ask_question'; expectedRevision: number; question: string; currentGuess: string }
  | { type: 'answer_question'; expectedRevision: number; expectedQuestionId: string; answer: string }
  | { type: 'surface_brief'; expectedRevision: number; brief: PlanningDecisionBrief }
  | { type: 'submit_brief'; expectedRevision: number; confidence: number; predictedNextAnswers: string[]; intentBlockingUnknowns: string[]; brief: PlanningDecisionBrief }
  | { type: 'confirm'; expectedRevision: number; expectedDigest: string }
  | {
      type: 'plan_with_assumptions'
      expectedRevision: number
      attestation: string
      reason: string
      acknowledgesPreservedOperationalGates: boolean
      brief?: PlanningDecisionBrief
    }
  | { type: 'reopen'; expectedRevision: number; reason?: string }

export type PlanningActionResult =
  | { ok: true; state: PlanningDiscoveryState; event: Record<string, unknown> }
  | { ok: false; error: string; status: number }

const PLANNING_ACTION_TYPES = new Set<PlanningAction['type']>([
  'start',
  'record_inspection',
  'ask_question',
  'answer_question',
  'surface_brief',
  'submit_brief',
  'confirm',
  'plan_with_assumptions',
  'reopen',
])

const INSPECTION_KEYS = ['brief', 'docs', 'files', 'plan', 'tasks', 'tools', 'agents', 'skills'] as const

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(clean).filter(Boolean)))
}

export function isPlanningDiscoveryActionType(value: unknown): value is PlanningAction['type'] {
  return typeof value === 'string' && PLANNING_ACTION_TYPES.has(value as PlanningAction['type'])
}

export function normalizeDecisionBrief(value: unknown): PlanningDecisionBrief | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const brief: PlanningDecisionBrief = {
    outcome: clean(raw.outcome),
    user: clean(raw.user),
    whyNow: clean(raw.whyNow),
    successCriteria: cleanArray(raw.successCriteria),
    constraints: cleanArray(raw.constraints),
    outOfScope: cleanArray(raw.outOfScope),
    assumptions: cleanArray(raw.assumptions),
    risks: cleanArray(raw.risks),
    approvalGates: cleanArray(raw.approvalGates),
  }
  const hasEverySection = brief.outcome
    && brief.user
    && brief.whyNow
    && brief.successCriteria.length > 0
    && brief.constraints.length > 0
    && brief.outOfScope.length > 0
    && brief.assumptions.length > 0
    && brief.risks.length > 0
    && brief.approvalGates.length > 0
  return hasEverySection ? brief : null
}

function normalizeInspectionEvidence(
  value: unknown,
  actor: { uid: string; now: string },
): PlanningInspectionEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const evidence = Object.fromEntries(INSPECTION_KEYS.map((key) => [key, cleanArray(source[key])])) as unknown as Omit<PlanningInspectionEvidence, 'inspectedBy' | 'inspectedAt'>
  if (INSPECTION_KEYS.some((key) => evidence[key].length === 0)) return null
  return { ...evidence, inspectedBy: actor.uid, inspectedAt: actor.now }
}

function hasCompleteInspection(value: unknown): value is PlanningInspectionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as Record<string, unknown>
  return INSPECTION_KEYS.every((key) => cleanArray(evidence[key]).length > 0)
    && Boolean(clean(evidence.inspectedBy) && clean(evidence.inspectedAt))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

export function planningDiscoveryDigest(brief: PlanningDecisionBrief): string {
  return createHash('sha256').update(JSON.stringify(stable(brief))).digest('hex')
}

function completedTurns(state: Partial<PlanningDiscoveryState>): PlanningInterviewTurn[] {
  return Array.isArray(state.turns)
    ? state.turns.filter((turn) => Boolean(clean(turn.answer) && clean(turn.answeredBy) && clean(turn.answeredAt)))
    : []
}

export function isPlanningReady(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<PlanningDiscoveryState>
  const brief = normalizeDecisionBrief(state.brief)
  if (state.schemaVersion !== 1 || !Number.isInteger(state.revision) || Number(state.revision) <= 0) return false
  if (clean(state.pendingQuestionId)) return false
  if (state.enforced !== true || !brief || !state.digest || planningDiscoveryDigest(brief) !== state.digest) return false
  if (!hasCompleteInspection(state.inspection)) return false

  if (state.status === 'confirmed' && state.mode === 'interview') {
    return typeof state.confidence === 'number'
      && state.confidence >= PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD
      && completedTurns(state).length > 0
      && Array.isArray(state.predictedNextAnswers)
      && state.predictedNextAnswers.length === 3
      && state.predictedNextAnswers.every((answer) => clean(answer).length > 0)
      && Array.isArray(state.intentBlockingUnknowns)
      && state.intentBlockingUnknowns.length === 0
      && Boolean(clean(state.confirmedBy) && clean(state.confirmedAt))
  }

  if (state.status === 'assumptions_attested' && state.mode === 'assumptions') {
    return state.attestation === PLAN_WITH_ASSUMPTIONS_ATTESTATION
      && clean(state.attestationReason).length >= 10
      && state.acknowledgesPreservedOperationalGates === true
      && Boolean(clean(state.confirmedBy) && clean(state.confirmedAt))
  }

  return false
}

export function planningMutationBlocker(project: Record<string, unknown>): null | { code: 'planning_discovery_required'; message: string; revision: number } {
  const state = project.planningDiscovery as Partial<PlanningDiscoveryState> | undefined
  if (isPlanningReady(state)) return null
  return {
    code: 'planning_discovery_required',
    message: state?.enforced
      ? 'Confirm the current Decision Brief or explicitly choose PLAN WITH ASSUMPTIONS before creating or releasing planned work.'
      : 'Start planning discovery before the next planning mutation. Existing in-flight execution remains operable.',
    revision: typeof state?.revision === 'number' ? state.revision : 0,
  }
}

const PROJECT_TASK_CONTEXT_FIELDS = new Set([
  'title', 'description', 'priority', 'dueDate', 'startDate', 'baselineDueDate', 'baselineStartDate',
  'estimateMinutes', 'order', 'dependsOn', 'approvalGateTaskId', 'approvalGate', 'requiredCapability',
  'riskLevel', 'expectedArtifacts', 'verifierChecklist', 'labels', 'checklist', 'internalOnly',
])

const PROJECT_TASK_PLANNING_FIELDS = new Set([
  ...PROJECT_TASK_CONTEXT_FIELDS,
  'assigneeId', 'assigneeIds', 'assigneeAgentId', 'agentInput', 'agentEffort', 'agentModel',
  'agentProvider', 'llmCredentialSource', 'llmCredentialOwnerUid',
  'agentRuntimeTargetId', 'llmConnectionId', 'llmCredentialBindingId',
  'agentReleaseAt', 'reviewerIds', 'reviewerAgentId',
])

export function isProjectTaskContextMutation(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((field) => PROJECT_TASK_CONTEXT_FIELDS.has(field))
}

export function isProjectTaskPlanningMutation(body: Record<string, unknown>): boolean {
  if (Object.keys(body).some((field) => PROJECT_TASK_PLANNING_FIELDS.has(field))) return true
  if (body.columnId !== undefined && body.columnId !== 'review' && body.columnId !== 'done') return true
  if (body.agentStatus !== undefined && !['picked-up', 'in-progress', 'done', 'blocked', 'awaiting-input'].includes(String(body.agentStatus))) return true
  return false
}

export function preparePlanningContextMutation(
  project: Record<string, unknown>,
  actor: { uid: string; now: string },
  reason: string,
): PlanningActionResult {
  const current = project.planningDiscovery as PlanningDiscoveryState | undefined
  if (!current?.enforced) return { ok: false, error: 'Start planning discovery first', status: 409 }
  return applyPlanningDiscoveryAction(current, {
    type: 'reopen',
    expectedRevision: current.revision,
    reason,
  }, actor)
}

export async function planningReadyProjectInTransaction(
  transaction: { get: (ref: unknown) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> },
  projectRef: unknown,
): Promise<
  | { ok: true; project: Record<string, unknown> }
  | { ok: false; status: 404; code: 'project_not_found'; message: string; revision: 0 }
  | { ok: false; status: 409; code: 'planning_discovery_required'; message: string; revision: number }
> {
  const snapshot = await transaction.get(projectRef)
  if (!snapshot.exists) {
    return { ok: false, status: 404, code: 'project_not_found', message: 'Project not found', revision: 0 }
  }
  const project = snapshot.data() ?? {}
  const blocker = planningMutationBlocker(project)
  if (blocker) return { ok: false, status: 409, ...blocker }
  return { ok: true, project }
}

function conflict(state: PlanningDiscoveryState | null, expectedRevision: unknown): PlanningActionResult | null {
  const current = state?.revision ?? 0
  return typeof expectedRevision === 'number' && expectedRevision === current
    ? null
    : { ok: false, error: `Planning discovery revision changed (expected ${String(expectedRevision)}, current ${current})`, status: 409 }
}

function changedState(
  current: PlanningDiscoveryState,
  actor: { uid: string; now: string },
  changes: Partial<PlanningDiscoveryState>,
): PlanningDiscoveryState {
  return {
    ...current,
    ...changes,
    revision: current.revision + 1,
    updatedBy: actor.uid,
    updatedAt: actor.now,
  }
}

function currentSnapshot(
  current: PlanningDiscoveryState,
  actor: { uid: string; now: string },
  reason: string,
): PlanningDiscoverySnapshot | null {
  const brief = normalizeDecisionBrief(current.brief)
  if (!brief || !current.digest) return null
  return {
    revision: current.revision,
    status: current.status,
    mode: current.mode,
    confidence: current.confidence,
    brief,
    digest: current.digest,
    confirmedBy: current.confirmedBy,
    confirmedAt: current.confirmedAt,
    staleReason: reason,
    staleAt: actor.now,
    staleBy: actor.uid,
  }
}

export function applyPlanningDiscoveryAction(
  current: PlanningDiscoveryState | null,
  action: PlanningAction,
  actor: { uid: string; now: string },
): PlanningActionResult {
  if (!action || typeof action !== 'object' || !isPlanningDiscoveryActionType(action.type)) {
    return { ok: false, error: 'Unknown planning discovery action', status: 400 }
  }

  if (action.type === 'start') {
    if (current) {
      const stale = conflict(current, action.expectedRevision)
      if (stale) return stale
      return { ok: false, error: 'Planning discovery has already started; reopen the current brief instead', status: 409 }
    }
    const state: PlanningDiscoveryState = {
      schemaVersion: 1,
      revision: 1,
      status: 'interviewing',
      mode: 'interview',
      enforced: true,
      turns: [],
      snapshots: [],
      startedBy: actor.uid,
      startedAt: actor.now,
      updatedBy: actor.uid,
      updatedAt: actor.now,
    }
    return { ok: true, state, event: { type: 'started', actorUid: actor.uid, at: actor.now, revision: state.revision } }
  }

  if (!current?.enforced) return { ok: false, error: 'Start planning discovery first', status: 409 }
  const stale = conflict(current, action.expectedRevision)
  if (stale) return stale

  if (action.type === 'record_inspection') {
    if (current.status !== 'interviewing' || current.brief || (current.turns?.length ?? 0) > 0 || current.pendingQuestionId) {
      return { ok: false, error: 'Reopen discovery before replacing inspection evidence', status: 409 }
    }
    const inspection = normalizeInspectionEvidence(action.evidence, actor)
    if (!inspection) {
      return { ok: false, error: 'Inspection evidence is required for brief, docs, files, Plan, tasks, tools, agents, and skills', status: 400 }
    }
    const state = changedState(current, actor, { inspection })
    return { ok: true, state, event: { type: 'inspection_recorded', actorUid: actor.uid, at: actor.now, revision: state.revision, inspection } }
  }

  if (action.type === 'ask_question') {
    if (current.status !== 'interviewing') return { ok: false, error: 'Reopen discovery before asking another planning question', status: 409 }
    if (!hasCompleteInspection(current.inspection)) return { ok: false, error: 'Complete project inspection before asking interview questions', status: 409 }
    if (current.pendingQuestionId) return { ok: false, error: 'Answer the current planning question before asking another', status: 409 }
    const question = clean(action.question)
    const currentGuess = clean(action.currentGuess)
    if (question.length < 10 || currentGuess.length < 3) {
      return { ok: false, error: 'A high-value question and current guess are required', status: 400 }
    }
    const turn: PlanningInterviewTurn = {
      id: `q-${current.revision + 1}`,
      question,
      currentGuess,
      askedBy: actor.uid,
      askedAt: actor.now,
    }
    const state = changedState(current, actor, {
      turns: [...(current.turns ?? []), turn],
      pendingQuestionId: turn.id,
    })
    return { ok: true, state, event: { type: 'question_asked', actorUid: actor.uid, at: actor.now, revision: state.revision, turn } }
  }

  if (action.type === 'answer_question') {
    if (!current.pendingQuestionId) return { ok: false, error: 'There is no pending planning question', status: 409 }
    if (action.expectedQuestionId !== current.pendingQuestionId) return { ok: false, error: 'Planning question changed; answer the current question', status: 409 }
    const answer = clean(action.answer)
    if (!answer) return { ok: false, error: 'A planning answer is required', status: 400 }
    const turns = (current.turns ?? []).map((turn) => turn.id === current.pendingQuestionId
      ? { ...turn, answer, answeredBy: actor.uid, answeredAt: actor.now }
      : turn)
    const answeredTurn = turns.find((turn) => turn.id === current.pendingQuestionId)
    if (!answeredTurn) return { ok: false, error: 'Pending planning question evidence is missing', status: 409 }
    const state = changedState(current, actor, { turns, pendingQuestionId: undefined })
    return { ok: true, state, event: { type: 'question_answered', actorUid: actor.uid, at: actor.now, revision: state.revision, turn: answeredTurn } }
  }

  if (action.type === 'surface_brief') {
    if (current.status !== 'interviewing') return { ok: false, error: 'Reopen discovery before surfacing another Decision Brief', status: 409 }
    if (!hasCompleteInspection(current.inspection)) return { ok: false, error: 'Complete project inspection before surfacing the Decision Brief', status: 409 }
    const brief = normalizeDecisionBrief(action.brief)
    if (!brief) return { ok: false, error: 'Decision Brief requires outcome, user, why now, success, constraints, out-of-scope, assumptions, risks, and approval gates', status: 400 }
    const digest = planningDiscoveryDigest(brief)
    const state = changedState(current, actor, { brief, digest })
    return { ok: true, state, event: { type: 'brief_surfaced', actorUid: actor.uid, at: actor.now, revision: state.revision, digest, brief } }
  }

  if (action.type === 'submit_brief') {
    if (current.status !== 'interviewing') return { ok: false, error: 'Reopen discovery before submitting another Decision Brief', status: 409 }
    if (!hasCompleteInspection(current.inspection)) return { ok: false, error: 'Complete project inspection before submitting the Decision Brief', status: 409 }
    if (current.pendingQuestionId || completedTurns(current).length === 0) {
      return { ok: false, error: 'Normal planning requires answered interview-turn evidence and no pending question', status: 400 }
    }
    if (!Number.isFinite(action.confidence) || action.confidence < PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD) {
      return { ok: false, error: `Normal planning requires at least ${PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD}% confidence`, status: 400 }
    }
    const predictedNextAnswers = cleanArray(action.predictedNextAnswers)
    if (predictedNextAnswers.length !== 3) {
      return { ok: false, error: 'Normal planning requires the ability to predict the next three answers', status: 400 }
    }
    if (!Array.isArray(action.intentBlockingUnknowns) || action.intentBlockingUnknowns.length > 0) {
      return { ok: false, error: 'Resolve every intent-blocking unknown before submitting the Decision Brief', status: 400 }
    }
    const brief = normalizeDecisionBrief(action.brief)
    if (!brief) return { ok: false, error: 'Decision Brief requires outcome, user, why now, success, constraints, out-of-scope, assumptions, risks, and approval gates', status: 400 }
    const digest = planningDiscoveryDigest(brief)
    const state = changedState(current, actor, {
      status: 'brief_ready',
      mode: 'interview',
      confidence: Math.min(100, Math.round(action.confidence)),
      predictedNextAnswers,
      intentBlockingUnknowns: [],
      brief,
      digest,
      confirmedBy: undefined,
      confirmedAt: undefined,
    })
    return { ok: true, state, event: { type: 'brief_submitted', actorUid: actor.uid, at: actor.now, revision: state.revision, digest, brief, confidence: state.confidence, predictedNextAnswers, intentBlockingUnknowns: [] } }
  }

  if (action.type === 'confirm') {
    if (current.status !== 'brief_ready' || !current.digest || !current.brief) return { ok: false, error: 'Submit the Decision Brief before confirming it', status: 409 }
    if (action.expectedDigest !== current.digest) return { ok: false, error: 'Decision Brief changed; review the current version before confirming', status: 409 }
    const state = changedState(current, actor, {
      status: 'confirmed',
      mode: 'interview',
      confirmedBy: actor.uid,
      confirmedAt: actor.now,
    })
    if (!isPlanningReady(state)) return { ok: false, error: 'Decision Brief no longer satisfies normal planning readiness', status: 409 }
    return { ok: true, state, event: { type: 'brief_confirmed', actorUid: actor.uid, at: actor.now, revision: state.revision, digest: state.digest, brief: state.brief } }
  }

  if (action.type === 'plan_with_assumptions') {
    if (current.status !== 'interviewing' && current.status !== 'brief_ready') {
      return { ok: false, error: 'Reopen discovery before choosing assumption mode', status: 409 }
    }
    if (action.attestation !== PLAN_WITH_ASSUMPTIONS_ATTESTATION) return { ok: false, error: `Attestation must exactly match ${PLAN_WITH_ASSUMPTIONS_ATTESTATION}`, status: 400 }
    if (clean(action.reason).length < 10) return { ok: false, error: 'A meaningful reason is required for assumption mode', status: 400 }
    if (action.acknowledgesPreservedOperationalGates !== true) return { ok: false, error: 'Acknowledge that all operational approval gates remain preserved', status: 400 }
    if (!hasCompleteInspection(current.inspection)) return { ok: false, error: 'Assumption mode still requires complete project inspection', status: 409 }
    const brief = normalizeDecisionBrief(current.brief)
    if (!brief || !current.digest) return { ok: false, error: 'Surface the Decision Brief before choosing assumption mode', status: 409 }
    if (action.brief !== undefined) {
      const proposed = normalizeDecisionBrief(action.brief)
      if (!proposed || planningDiscoveryDigest(proposed) !== current.digest) {
        return { ok: false, error: 'Assumption mode cannot replace the previously surfaced Decision Brief', status: 409 }
      }
    }
    const state = changedState(current, actor, {
      status: 'assumptions_attested',
      mode: 'assumptions',
      confidence: undefined,
      attestation: PLAN_WITH_ASSUMPTIONS_ATTESTATION,
      attestationReason: clean(action.reason),
      acknowledgesPreservedOperationalGates: true,
      confirmedBy: actor.uid,
      confirmedAt: actor.now,
    })
    if (!isPlanningReady(state)) return { ok: false, error: 'Decision Brief no longer satisfies assumption-mode readiness', status: 409 }
    return { ok: true, state, event: { type: 'assumptions_attested', actorUid: actor.uid, at: actor.now, revision: state.revision, digest: state.digest, reason: state.attestationReason, brief: state.brief, acknowledgesPreservedOperationalGates: true } }
  }

  const reason = clean(action.reason) || 'Planning discovery reopened'
  const snapshot = currentSnapshot(current, actor, reason)
  const snapshots = snapshot ? [...(current.snapshots ?? []), snapshot] : [...(current.snapshots ?? [])]
  const state = changedState(current, actor, {
    status: 'interviewing',
    mode: 'interview',
    inspection: undefined,
    turns: [],
    pendingQuestionId: undefined,
    predictedNextAnswers: undefined,
    intentBlockingUnknowns: undefined,
    confidence: undefined,
    brief: undefined,
    digest: undefined,
    confirmedBy: undefined,
    confirmedAt: undefined,
    attestation: undefined,
    attestationReason: undefined,
    acknowledgesPreservedOperationalGates: undefined,
    snapshots,
  })
  return {
    ok: true,
    state,
    event: {
      type: 'reopened',
      actorUid: actor.uid,
      at: actor.now,
      revision: state.revision,
      reason,
      ...(snapshot ? {
        previousRevision: snapshot.revision,
        previousStatus: snapshot.status,
        previousDigest: snapshot.digest,
        previousBrief: snapshot.brief,
      } : {}),
    },
  }
}
