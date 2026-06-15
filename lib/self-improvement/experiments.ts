export type LifeExperimentStatus = 'planned' | 'running' | 'completed'
export type LifeExperimentDecision = 'adopt' | 'iterate' | 'abandon'
export type AdaptationSuggestionType =
  | 'schedule-change'
  | 'action-shrink'
  | 'evidence-check'
  | 'promote-to-routine'
  | 'goal-adjustment'
  | 'remove-or-replace'

export interface ExperimentMetricDelta {
  metric: string
  baseline: number
  latest: number
  direction: 'up' | 'down' | 'flat'
}

export interface LifeExperimentInput {
  orgId: string
  ownerId: string
  title: string
  hypothesis: string
  startDate: string
  endDate: string
  linkedGoalId?: string
  linkedActionIds?: string[]
  actions: string[]
  evidence: string[]
  successCriteria: string[]
}

export interface LifeExperimentResult {
  summary: string
  evidence: string[]
  metricDeltas: ExperimentMetricDelta[]
}

export interface PlanAdaptationSuggestion {
  type: AdaptationSuggestionType
  priority: 'low' | 'medium' | 'high'
  rationale: string
  suggestedChange: string
  target?: {
    goalId?: string
    actionIds?: string[]
  }
}

export interface LifeExperimentRecord {
  id: string
  orgId: string
  ownerId: string
  title: string
  status: LifeExperimentStatus
  hypothesis: string
  startDate: string
  endDate: string
  durationDays: number
  linkedGoalId?: string
  linkedActionIds: string[]
  actions: string[]
  evidencePlan: string[]
  successCriteria: string[]
  result: LifeExperimentResult | null
  decision: LifeExperimentDecision | null
  decidedAt: string | null
  adaptationSuggestions: PlanAdaptationSuggestion[]
  createdAt: string
  updatedAt: string
}

export interface CompleteLifeExperimentInput {
  result: LifeExperimentResult
  decision: LifeExperimentDecision
  decidedAt?: string
}

export interface ExperimentLoopSummary {
  totalExperiments: number
  activeExperiments: number
  completedExperiments: number
  decisions: Record<LifeExperimentDecision, number>
  topSuggestions: PlanAdaptationSuggestion[]
  nextAdaptationPrompt: string
}

function stableId(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(':').toLowerCase().replace(/[^a-z0-9:-]+/g, '-').replace(/-+/g, '-').slice(0, 160)
}

function normalizeList(values: string[], label: string, limit = 20) {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, limit)
  if (normalized.length === 0) throw new Error(`${label} must include at least one item`)
  return normalized
}

function validateDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function validateText(value: string | undefined, label: string) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function durationDays(startDate: string, endDate: string) {
  validateDate(startDate, 'startDate')
  validateDate(endDate, 'endDate')
  if (endDate < startDate) throw new Error('endDate must be on or after startDate')
  const start = Date.parse(`${startDate}T00:00:00.000Z`)
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  return Math.round((end - start) / 86_400_000) + 1
}

function buildPlanningSuggestions(input: {
  title: string
  startDate: string
  endDate: string
  linkedGoalId?: string
  linkedActionIds: string[]
  actions: string[]
  successCriteria: string[]
}): PlanAdaptationSuggestion[] {
  return [
    {
      type: 'schedule-change',
      priority: 'medium',
      rationale: `Run "${input.title}" from ${input.startDate} to ${input.endDate} before changing the plan permanently.`,
      suggestedChange: `Time-box the plan change and review evidence before adopting it as a routine.`,
      target: { goalId: input.linkedGoalId, actionIds: input.linkedActionIds },
    },
    {
      type: 'evidence-check',
      priority: 'medium',
      rationale: `Success should be judged against ${input.successCriteria.join('; ')} rather than motivation or memory.`,
      suggestedChange: `Attach evidence to the experiment review before updating goals or daily actions.`,
      target: { goalId: input.linkedGoalId, actionIds: input.linkedActionIds },
    },
  ]
}

function buildDecisionSuggestions(experiment: LifeExperimentRecord, decision: LifeExperimentDecision, result: LifeExperimentResult): PlanAdaptationSuggestion[] {
  const firstAction = experiment.actions[0] ?? experiment.title
  const firstCriterion = experiment.successCriteria[0] ?? result.summary

  if (decision === 'adopt') {
    return [
      ...buildPlanningSuggestions(experiment),
      {
        type: 'promote-to-routine',
        priority: 'high',
        rationale: `The experiment was adopted after evidence: ${result.summary}`,
        suggestedChange: `Promote "${firstAction}" into the weekly plan as the default routine.`,
        target: { goalId: experiment.linkedGoalId, actionIds: experiment.linkedActionIds },
      },
      {
        type: 'goal-adjustment',
        priority: 'high',
        rationale: `Adopted experiments should change the plan, not remain as notes.`,
        suggestedChange: `Update the related goal or habit target around ${firstCriterion}.`,
        target: { goalId: experiment.linkedGoalId, actionIds: experiment.linkedActionIds },
      },
    ]
  }

  if (decision === 'iterate') {
    return [
      ...buildPlanningSuggestions(experiment),
      {
        type: 'action-shrink',
        priority: 'high',
        rationale: `The experiment needs another pass: ${result.summary}`,
        suggestedChange: `Shrink or move "${firstAction}" and run one more time-boxed iteration.`,
        target: { goalId: experiment.linkedGoalId, actionIds: experiment.linkedActionIds },
      },
    ]
  }

  return [
    ...buildPlanningSuggestions(experiment),
    {
      type: 'remove-or-replace',
      priority: 'high',
      rationale: `The experiment should not keep consuming plan capacity: ${result.summary}`,
      suggestedChange: `Archive or replace "${firstAction}" with a lower-friction alternative.`,
      target: { goalId: experiment.linkedGoalId, actionIds: experiment.linkedActionIds },
    },
  ]
}

export function buildLifeExperiment(input: LifeExperimentInput, now = new Date().toISOString()): LifeExperimentRecord {
  const orgId = validateText(input.orgId, 'orgId')
  const ownerId = validateText(input.ownerId, 'ownerId')
  const title = validateText(input.title, 'title')
  const hypothesis = validateText(input.hypothesis, 'hypothesis')
  const linkedActionIds = Array.from(new Set((input.linkedActionIds ?? []).map((id) => id.trim()).filter(Boolean)))
  const record: LifeExperimentRecord = {
    id: stableId([orgId, ownerId, 'experiment', title, input.startDate, input.endDate]),
    orgId,
    ownerId,
    title,
    status: 'planned',
    hypothesis,
    startDate: input.startDate,
    endDate: input.endDate,
    durationDays: durationDays(input.startDate, input.endDate),
    linkedGoalId: input.linkedGoalId?.trim() || undefined,
    linkedActionIds,
    actions: normalizeList(input.actions, 'actions'),
    evidencePlan: normalizeList(input.evidence, 'evidence'),
    successCriteria: normalizeList(input.successCriteria, 'successCriteria'),
    result: null,
    decision: null,
    decidedAt: null,
    adaptationSuggestions: [],
    createdAt: now,
    updatedAt: now,
  }

  return {
    ...record,
    adaptationSuggestions: buildPlanningSuggestions(record),
  }
}

export function completeLifeExperiment(
  experiment: LifeExperimentRecord,
  completion: CompleteLifeExperimentInput,
  now = new Date().toISOString(),
): LifeExperimentRecord {
  const result: LifeExperimentResult = {
    summary: validateText(completion.result.summary, 'result.summary'),
    evidence: normalizeList(completion.result.evidence, 'result.evidence'),
    metricDeltas: completion.result.metricDeltas ?? [],
  }

  return {
    ...experiment,
    status: 'completed',
    result,
    decision: completion.decision,
    decidedAt: completion.decidedAt ?? now,
    adaptationSuggestions: buildDecisionSuggestions(experiment, completion.decision, result),
    updatedAt: now,
  }
}

export function summarizeExperimentLoop(experiments: LifeExperimentRecord[]): ExperimentLoopSummary {
  const completed = experiments.filter((experiment) => experiment.status === 'completed')
  const active = experiments.filter((experiment) => experiment.status !== 'completed')
  const topSuggestions = experiments.flatMap((experiment) => experiment.adaptationSuggestions).slice(0, 6)
  const nextExperiment = active[0] ?? experiments[0]

  return {
    totalExperiments: experiments.length,
    activeExperiments: active.length,
    completedExperiments: completed.length,
    decisions: {
      adopt: completed.filter((experiment) => experiment.decision === 'adopt').length,
      iterate: completed.filter((experiment) => experiment.decision === 'iterate').length,
      abandon: completed.filter((experiment) => experiment.decision === 'abandon').length,
    },
    topSuggestions,
    nextAdaptationPrompt: nextExperiment
      ? `Review "${nextExperiment.title}" evidence and decide whether to adopt, iterate, or abandon the plan change.`
      : 'Create one small experiment before adapting the plan.',
  }
}
