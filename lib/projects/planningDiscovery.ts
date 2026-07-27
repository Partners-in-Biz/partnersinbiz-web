import { createHash } from 'node:crypto'

export const PLAN_WITH_ASSUMPTIONS_ATTESTATION = 'PLAN WITH ASSUMPTIONS'
export const PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD = 95

export type PlanningDecisionBrief = {
  outcome: string
  whyNow: string
  successCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  assumptions: string[]
  risks: string[]
  approvalGates: string[]
}

export type PlanningDiscoveryState = {
  schemaVersion: 1
  revision: number
  status: 'interviewing' | 'brief_ready' | 'confirmed' | 'assumptions_attested'
  mode: 'interview' | 'assumptions'
  enforced: true
  confidence?: number
  brief?: PlanningDecisionBrief
  digest?: string
  startedBy?: string
  startedAt?: string
  updatedBy?: string
  updatedAt?: string
  confirmedBy?: string
  confirmedAt?: string
  attestation?: typeof PLAN_WITH_ASSUMPTIONS_ATTESTATION
  attestationReason?: string
}

type PlanningAction =
  | { type: 'start'; expectedRevision?: number }
  | { type: 'submit_brief'; expectedRevision: number; confidence: number; brief: PlanningDecisionBrief }
  | { type: 'confirm'; expectedRevision: number; expectedDigest: string }
  | { type: 'plan_with_assumptions'; expectedRevision: number; attestation: string; reason: string; brief: PlanningDecisionBrief }
  | { type: 'reopen'; expectedRevision: number }

export type PlanningActionResult =
  | { ok: true; state: PlanningDiscoveryState; event: Record<string, unknown> }
  | { ok: false; error: string; status: number }

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(clean).filter(Boolean)))
}

export function normalizeDecisionBrief(value: unknown): PlanningDecisionBrief | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const brief: PlanningDecisionBrief = {
    outcome: clean(raw.outcome),
    whyNow: clean(raw.whyNow),
    successCriteria: cleanArray(raw.successCriteria),
    constraints: cleanArray(raw.constraints),
    outOfScope: cleanArray(raw.outOfScope),
    assumptions: cleanArray(raw.assumptions),
    risks: cleanArray(raw.risks),
    approvalGates: cleanArray(raw.approvalGates),
  }
  if (!brief.outcome || !brief.whyNow || brief.successCriteria.length === 0) return null
  return brief
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  }
  return value
}

export function planningDiscoveryDigest(brief: PlanningDecisionBrief): string {
  return createHash('sha256').update(JSON.stringify(stable(brief))).digest('hex')
}

export function isPlanningReady(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PlanningDiscoveryState>
  return state.enforced === true && (state.status === 'confirmed' || state.status === 'assumptions_attested') && Boolean(state.digest && state.brief)
}

export function planningMutationBlocker(project: Record<string, unknown>): null | { code: 'planning_discovery_required'; message: string; revision: number } {
  const state = project.planningDiscovery as Partial<PlanningDiscoveryState> | undefined
  if (!state?.enforced) return null // lazy legacy migration: first discovery start opts the project into enforcement
  if (isPlanningReady(state)) return null
  return {
    code: 'planning_discovery_required',
    message: 'Confirm the current Decision Brief or explicitly choose PLAN WITH ASSUMPTIONS before creating or releasing planned work.',
    revision: typeof state.revision === 'number' ? state.revision : 0,
  }
}

function conflict(state: PlanningDiscoveryState | null, expectedRevision: number): PlanningActionResult | null {
  const current = state?.revision ?? 0
  return expectedRevision === current ? null : { ok: false, error: `Planning discovery revision changed (expected ${expectedRevision}, current ${current})`, status: 409 }
}

export function applyPlanningDiscoveryAction(
  current: PlanningDiscoveryState | null,
  action: PlanningAction,
  actor: { uid: string; now: string },
): PlanningActionResult {
  if (action.type === 'start') {
    if (current) {
      const stale = conflict(current, action.expectedRevision ?? -1)
      if (stale) return stale
      return { ok: false, error: 'Planning discovery has already started; reopen the current brief instead', status: 409 }
    }
    const state: PlanningDiscoveryState = {
      schemaVersion: 1,
      revision: (current?.revision ?? 0) + 1,
      status: 'interviewing',
      mode: 'interview',
      enforced: true,
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

  if (action.type === 'submit_brief') {
    if (!Number.isFinite(action.confidence) || action.confidence < PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD) {
      return { ok: false, error: `Normal planning requires at least ${PLANNING_DISCOVERY_CONFIDENCE_THRESHOLD}% confidence`, status: 400 }
    }
    const brief = normalizeDecisionBrief(action.brief)
    if (!brief) return { ok: false, error: 'Decision Brief requires outcome, why now, and at least one success criterion', status: 400 }
    const state: PlanningDiscoveryState = {
      ...current,
      revision: current.revision + 1,
      status: 'brief_ready',
      mode: 'interview',
      confidence: Math.min(100, Math.round(action.confidence)),
      brief,
      digest: planningDiscoveryDigest(brief),
      updatedBy: actor.uid,
      updatedAt: actor.now,
    }
    return { ok: true, state, event: { type: 'brief_submitted', actorUid: actor.uid, at: actor.now, revision: state.revision, digest: state.digest, brief } }
  }

  if (action.type === 'confirm') {
    if (current.status !== 'brief_ready' || !current.digest || !current.brief) return { ok: false, error: 'Submit the Decision Brief before confirming it', status: 409 }
    if (action.expectedDigest !== current.digest) return { ok: false, error: 'Decision Brief changed; review the current version before confirming', status: 409 }
    const state: PlanningDiscoveryState = {
      ...current,
      revision: current.revision + 1,
      status: 'confirmed',
      confirmedBy: actor.uid,
      confirmedAt: actor.now,
      updatedBy: actor.uid,
      updatedAt: actor.now,
    }
    return { ok: true, state, event: { type: 'brief_confirmed', actorUid: actor.uid, at: actor.now, revision: state.revision, digest: state.digest } }
  }

  if (action.type === 'plan_with_assumptions') {
    if (action.attestation !== PLAN_WITH_ASSUMPTIONS_ATTESTATION) return { ok: false, error: `Attestation must exactly match ${PLAN_WITH_ASSUMPTIONS_ATTESTATION}`, status: 400 }
    if (clean(action.reason).length < 10) return { ok: false, error: 'A meaningful reason is required for assumption mode', status: 400 }
    const brief = normalizeDecisionBrief(action.brief)
    if (!brief || brief.assumptions.length === 0) return { ok: false, error: 'Assumption mode requires a complete Decision Brief with at least one explicit assumption', status: 400 }
    const state: PlanningDiscoveryState = {
      ...current,
      revision: current.revision + 1,
      status: 'assumptions_attested',
      mode: 'assumptions',
      brief,
      digest: planningDiscoveryDigest(brief),
      attestation: PLAN_WITH_ASSUMPTIONS_ATTESTATION,
      attestationReason: clean(action.reason),
      confirmedBy: actor.uid,
      confirmedAt: actor.now,
      updatedBy: actor.uid,
      updatedAt: actor.now,
    }
    return { ok: true, state, event: { type: 'assumptions_attested', actorUid: actor.uid, at: actor.now, revision: state.revision, digest: state.digest, reason: state.attestationReason, brief } }
  }

  const state: PlanningDiscoveryState = {
    ...current,
    revision: current.revision + 1,
    status: 'interviewing',
    mode: 'interview',
    confidence: undefined,
    brief: undefined,
    digest: undefined,
    confirmedBy: undefined,
    confirmedAt: undefined,
    attestation: undefined,
    attestationReason: undefined,
    updatedBy: actor.uid,
    updatedAt: actor.now,
  }
  return { ok: true, state, event: { type: 'reopened', actorUid: actor.uid, at: actor.now, revision: state.revision } }
}
