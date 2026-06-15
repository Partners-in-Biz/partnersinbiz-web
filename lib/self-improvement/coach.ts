import type { GoalBreakdownPlan } from '@/lib/self-improvement/planning'
import type { DailyCheckInRecord, WeeklyReviewRecord } from '@/lib/self-improvement/reflections'

type SafetyLevel = 'none' | 'medical' | 'mental-health' | 'crisis'
type ResponseMode = 'normal-coaching' | 'refer-to-professional' | 'support-with-referral' | 'crisis-support'

export type ScopedGoalBreakdownPlan = GoalBreakdownPlan & {
  orgId?: string
  ownerId?: string
}

export interface CoachWorkflowInput {
  orgId: string
  ownerId: string
  plan?: ScopedGoalBreakdownPlan
  dailyCheckIns?: DailyCheckInRecord[]
  weeklyReviews?: WeeklyReviewRecord[]
  userMessage?: string
}

export interface CoachSafetyBoundary {
  level: SafetyLevel
  escalate: boolean
  responseMode: ResponseMode
  message: string
  allowedCoachActions: string[]
}

export interface CoachContextAssembly {
  orgId: string
  ownerId: string
  identityDirection: string
  planSnapshot: {
    activeOutcomes: string[]
    activeCommitments: string[]
    plannedActions: string[]
    completedActions: string[]
    missedActions: string[]
    reviewPrompt: string
  }
  reflectionSummary: {
    wins: string[]
    misses: string[]
    lessons: string[]
    blockers: string[]
    priorities: string[]
    energyTrend: 'unknown' | 'low' | 'steady' | 'high'
    moodTrend: 'unknown' | 'low' | 'steady' | 'high'
    summaryText: string
  }
  obstacleDiagnosis: ObstacleDiagnosis
  experimentBacklog: CoachExperiment[]
}

export interface ObstacleDiagnosis {
  primaryObstacle: string
  likelyPattern: string
  evidence: string[]
  coachingQuestion: string
}

export interface CoachExperiment {
  title: string
  hypothesis: string
  nextAction: string
  successMetric: string
  reviewAfterDays: number
}

export interface PlanSuggestion {
  type: 'keep' | 'shrink' | 'reschedule' | 'remove' | 'clarify'
  title: string
  reason: string
  suggestedAction: string
}

export interface PromptGuardrails {
  system: string
  must: string[]
  mustNot: string[]
  outputShape: string[]
}

export interface AiCoachWorkflow {
  context: CoachContextAssembly
  promptGuardrails: PromptGuardrails
  planSuggestions: PlanSuggestion[]
  obstacleDiagnosis: ObstacleDiagnosis
  reflectionSummary: string
  experimentRecommendations: CoachExperiment[]
  safetyBoundary: CoachSafetyBoundary
}

const crisisPattern = /\b(kill myself|suicide|suicidal|end my life|hurt myself|self[- ]?harm|do not feel safe|don't feel safe|not safe|harm myself|want to die|can't go on|cannot go on|overdose|cut myself)\b/i
const medicalPattern = /\b(doctor|medical|medication|medicine|dose|dosage|prescription|antidepressant|supplement|diagnosis|treatment|therapy plan|chest pain|can't breathe|cannot breathe)\b/i
const mentalHealthPattern = /\b(depressed|depression|anxiety|panic attack|adhd|bipolar|ptsd|trauma|eating disorder|addiction|therapist|psychiatrist)\b/i

export function detectSafetyBoundary(text = ''): CoachSafetyBoundary {
  if (crisisPattern.test(text)) {
    return {
      level: 'crisis',
      escalate: true,
      responseMode: 'crisis-support',
      message: 'I cannot treat this as a productivity moment. If there is any immediate danger, contact local emergency services now, or reach a trusted person who can stay with you while you get help.',
      allowedCoachActions: [
        'acknowledge distress',
        'encourage immediate local emergency/support contact',
        'pause productivity coaching',
        'suggest staying with or contacting a trusted person',
      ],
    }
  }

  if (medicalPattern.test(text)) {
    return {
      level: 'medical',
      escalate: true,
      responseMode: 'refer-to-professional',
      message: 'This needs qualified medical guidance. I can help you prepare notes or questions, but I cannot diagnose, prescribe, change dosages, or replace a clinician.',
      allowedCoachActions: [
        'encourage qualified professional support',
        'help prepare questions or symptom notes',
        'avoid diagnosis and treatment instructions',
      ],
    }
  }

  if (mentalHealthPattern.test(text)) {
    return {
      level: 'mental-health',
      escalate: true,
      responseMode: 'support-with-referral',
      message: 'I can offer supportive reflection and help you choose a small next step, but I cannot diagnose or replace a mental-health professional. Consider speaking with a qualified professional if this is persistent, severe, or unsafe.',
      allowedCoachActions: [
        'validate and reflect without diagnosis',
        'suggest a small supportive next step',
        'encourage qualified mental-health support',
        'avoid clinical labels and treatment plans',
      ],
    }
  }

  return {
    level: 'none',
    escalate: false,
    responseMode: 'normal-coaching',
    message: 'Normal coaching may continue inside non-clinical, non-crisis boundaries.',
    allowedCoachActions: ['reflect', 'prioritize', 'diagnose practical obstacles', 'suggest small experiments'],
  }
}

export function assembleCoachContext(input: CoachWorkflowInput): CoachContextAssembly {
  validateCoachInputScope(input)
  const dailyCheckIns = latest(input.dailyCheckIns ?? [], getDailyTime, 7)
  const weeklyReviews = latest(input.weeklyReviews ?? [], getWeeklyTime, 4)
  const reflections = [...dailyCheckIns, ...weeklyReviews]
  const plan = input.plan
  const wins = unique(reflections.flatMap((item) => item.wins), 8)
  const misses = unique(reflections.flatMap((item) => item.misses), 8)
  const lessons = unique(reflections.flatMap((item) => item.lessons), 8)
  const blockers = unique(reflections.flatMap((item) => item.blockers), 8)
  const priorities = unique(reflections.flatMap((item) => item.priorities), 8)
  const experiments = unique(reflections.flatMap((item) => item.nextExperiments), 8)
  const energyTrend = scoreTrend(reflections.map((item) => item.energy))
  const moodTrend = scoreTrend(reflections.map((item) => item.mood))
  const planSnapshot = {
    activeOutcomes: plan?.activeQuarterlyOutcomes.map((item) => item.title) ?? [],
    activeCommitments: plan?.activeWeeklyCommitments.map((item) => item.title) ?? [],
    plannedActions: plan?.activeDailyActions.filter((action) => action.status === 'planned').map((item) => item.title) ?? [],
    completedActions: plan?.activeDailyActions.filter((action) => action.status === 'done').map((item) => item.title) ?? [],
    missedActions: plan?.activeDailyActions.filter((action) => action.status === 'missed').map((item) => item.title) ?? [],
    reviewPrompt: plan?.reviewProgress.nextReviewPrompt ?? 'Review the latest evidence and choose one honest next step.',
  }
  const reflectionSummary = {
    wins,
    misses,
    lessons,
    blockers,
    priorities,
    energyTrend,
    moodTrend,
    summaryText: buildReflectionSummaryText(wins, misses, lessons, blockers, energyTrend, moodTrend),
  }
  const obstacleDiagnosis = diagnoseObstacle({ blockers, misses, planSnapshot, energyTrend })

  return {
    orgId: input.orgId.trim(),
    ownerId: input.ownerId.trim(),
    identityDirection: plan ? `${plan.vision.title} (${plan.vision.horizon})` : 'No long-term vision captured yet.',
    planSnapshot,
    reflectionSummary,
    obstacleDiagnosis,
    experimentBacklog: buildExperimentBacklog(experiments, obstacleDiagnosis, priorities, planSnapshot),
  }
}

export function buildAiCoachWorkflow(input: CoachWorkflowInput): AiCoachWorkflow {
  validateCoachInputScope(input)
  const safetyBoundary = detectSafetyBoundary(buildSafetyScanText(input))

  if (safetyBoundary.escalate) {
    return buildEscalatedWorkflow(input, safetyBoundary, safetyBoundary.message)
  }

  const context = assembleCoachContext(input)
  const planSuggestions = buildPlanSuggestions(context)
  const experimentRecommendations = buildExperimentRecommendations(context)

  return {
    context,
    promptGuardrails: buildPromptGuardrails(safetyBoundary),
    planSuggestions,
    obstacleDiagnosis: context.obstacleDiagnosis,
    reflectionSummary: safetyBoundary.escalate ? safetyBoundary.message : context.reflectionSummary.summaryText,
    experimentRecommendations,
    safetyBoundary,
  }
}

function assertScope(input: CoachWorkflowInput) {
  if (!input.orgId?.trim()) throw new Error('orgId is required')
  if (!input.ownerId?.trim()) throw new Error('ownerId is required')
}

function validateCoachInputScope(input: CoachWorkflowInput) {
  assertScope(input)
  const orgId = input.orgId.trim()
  const ownerId = input.ownerId.trim()

  if (input.plan?.orgId && input.plan.orgId !== orgId) throw new Error('plan orgId must match coach orgId')
  if (input.plan?.ownerId && input.plan.ownerId !== ownerId) throw new Error('plan ownerId must match coach ownerId')

  for (const record of [...(input.dailyCheckIns ?? []), ...(input.weeklyReviews ?? [])]) {
    if (record.orgId !== orgId) throw new Error('reflection orgId must match coach orgId')
    if (record.ownerId !== ownerId) throw new Error('reflection ownerId must match coach ownerId')
  }
}

function buildEscalatedWorkflow(input: CoachWorkflowInput, safetyBoundary: CoachSafetyBoundary, summary: string): AiCoachWorkflow {
  assertScope(input)
  const obstacleDiagnosis: ObstacleDiagnosis = {
    primaryObstacle: 'safety boundary active',
    likelyPattern: safetyBoundary.message,
    evidence: [],
    coachingQuestion: 'Can you contact local emergency support or a trusted person now?',
  }
  const context: CoachContextAssembly = {
    orgId: input.orgId.trim(),
    ownerId: input.ownerId.trim(),
    identityDirection: 'Safety support takes priority over productivity coaching.',
    planSnapshot: {
      activeOutcomes: [],
      activeCommitments: [],
      plannedActions: [],
      completedActions: [],
      missedActions: [],
      reviewPrompt: safetyBoundary.message,
    },
    reflectionSummary: {
      wins: [],
      misses: [],
      lessons: [],
      blockers: [],
      priorities: [],
      energyTrend: 'unknown',
      moodTrend: 'unknown',
      summaryText: summary,
    },
    obstacleDiagnosis,
    experimentBacklog: [],
  }

  return {
    context,
    promptGuardrails: buildPromptGuardrails(safetyBoundary),
    planSuggestions: [],
    obstacleDiagnosis,
    reflectionSummary: summary,
    experimentRecommendations: [],
    safetyBoundary,
  }
}

function buildSafetyScanText(input: CoachWorkflowInput) {
  return extractText(input).join('\n')
}

function extractText(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []
  if (seen.has(value)) return []
  seen.add(value)

  if (Array.isArray(value)) return value.flatMap((item) => extractText(item, seen))

  return Object.values(value as Record<string, unknown>).flatMap((item) => extractText(item, seen))
}

function latest<T>(items: T[], timeOf: (item: T) => string, limit: number) {
  return [...items].sort((a, b) => timeOf(b).localeCompare(timeOf(a))).slice(0, limit)
}

function getDailyTime(item: DailyCheckInRecord) {
  return item.localDate || item.createdAt
}

function getWeeklyTime(item: WeeklyReviewRecord) {
  return item.periodEnd || item.updatedAt
}

function unique(values: string[], limit: number) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit)
}

function scoreTrend(scores: number[]): 'unknown' | 'low' | 'steady' | 'high' {
  if (!scores.length) return 'unknown'
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  if (average <= 2.75) return 'low'
  if (average >= 4) return 'high'
  return 'steady'
}

function buildReflectionSummaryText(wins: string[], misses: string[], lessons: string[], blockers: string[], energyTrend: string, moodTrend: string) {
  return [
    `Wins: ${wins.length ? wins.join('; ') : 'none captured yet'}`,
    `Misses: ${misses.length ? misses.join('; ') : 'none captured yet'}`,
    `Lessons: ${lessons.length ? lessons.join('; ') : 'none captured yet'}`,
    `Blockers: ${blockers.length ? blockers.join('; ') : 'none captured yet'}`,
    `Energy trend: ${energyTrend}`,
    `Mood trend: ${moodTrend}`,
  ].join('\n')
}

function diagnoseObstacle(input: {
  blockers: string[]
  misses: string[]
  planSnapshot: CoachContextAssembly['planSnapshot']
  energyTrend: CoachContextAssembly['reflectionSummary']['energyTrend']
}): ObstacleDiagnosis {
  const evidence = unique([...input.blockers, ...input.misses, ...input.planSnapshot.missedActions], 8)
  const primaryObstacle = evidence[0] ?? 'unclear obstacle'
  const evidenceText = evidence.join(' ').toLowerCase()
  const scheduleFriction = /meeting|calendar|late|time|interrupt|context|overrun|slack|call/.test(evidenceText)
  const energyFriction = input.energyTrend === 'low' || /fatigue|tired|sleep|energy|exhaust/.test(evidenceText)
  const likelyPattern = scheduleFriction
    ? 'Schedule friction is making the intended action too late or too exposed to interruptions.'
    : energyFriction
      ? 'Energy friction is making the action too large for the current recovery capacity.'
      : 'The current plan needs a clearer cue, smaller action, or stronger environment design.'

  return {
    primaryObstacle,
    likelyPattern,
    evidence,
    coachingQuestion: primaryObstacle === 'unclear obstacle'
      ? 'What made the next step harder than expected?'
      : `What would make "${primaryObstacle}" easier to work around tomorrow?`,
  }
}

function buildExperimentBacklog(experiments: string[], obstacle: ObstacleDiagnosis, priorities: string[], planSnapshot: CoachContextAssembly['planSnapshot']): CoachExperiment[] {
  const focus = priorities[0] ?? planSnapshot.activeCommitments[0] ?? planSnapshot.activeOutcomes[0] ?? 'next priority'
  const base = experiments.length ? experiments : [`Try a smaller version of ${focus}`]
  return base.slice(0, 5).map((experiment) => ({
    title: experiment,
    hypothesis: `If ${experiment.toLowerCase()}, then ${obstacle.primaryObstacle} should become easier to navigate.`,
    nextAction: `Schedule or perform the smallest version of: ${experiment}.`,
    successMetric: `One check-in records whether ${focus} became easier within the next week.`,
    reviewAfterDays: 7,
  }))
}

function buildExperimentRecommendations(context: CoachContextAssembly) {
  return buildExperimentBacklog(
    context.experimentBacklog.map((item) => item.title),
    context.obstacleDiagnosis,
    context.reflectionSummary.priorities,
    context.planSnapshot,
  )
}

function buildPlanSuggestions(context: CoachContextAssembly): PlanSuggestion[] {
  const suggestions: PlanSuggestion[] = []
  const lowCapacity = context.reflectionSummary.energyTrend === 'low' || context.reflectionSummary.moodTrend === 'low'
  const missed = context.planSnapshot.missedActions[0]
  const planned = context.planSnapshot.plannedActions[0]

  if (lowCapacity && (missed || planned)) {
    suggestions.push({
      type: 'shrink',
      title: missed ?? planned,
      reason: 'Recent reflection shows low energy or mood, so the safest useful move is to reduce the action size without dropping the commitment.',
      suggestedAction: `Create a minimum viable version of "${missed ?? planned}" that can be done in 2-10 minutes.`,
    })
  }

  if (missed) {
    suggestions.push({
      type: 'reschedule',
      title: missed,
      reason: `The missed action appears connected to: ${context.obstacleDiagnosis.primaryObstacle}.`,
      suggestedAction: `Move "${missed}" before the blocker window or attach it to a stronger cue.`,
    })
  }

  if (!suggestions.length) {
    suggestions.push({
      type: 'keep',
      title: context.planSnapshot.activeCommitments[0] ?? 'current plan',
      reason: 'Current evidence does not show a strong need to change the plan.',
      suggestedAction: 'Keep the next action and review after one more check-in.',
    })
  }

  return suggestions
}

function buildPromptGuardrails(safety: CoachSafetyBoundary): PromptGuardrails {
  const outputShape = safety.level === 'crisis'
    ? ['crisis safety note', 'immediate support option', 'trusted-person reminder']
    : safety.escalate
      ? ['safety note', 'professional-support referral', 'one non-clinical supportive next step']
      : [
          'safety note when applicable',
          'reflection summary',
          'obstacle diagnosis',
          'one plan suggestion',
          'one small experiment with review date',
        ]

  return {
    system: [
      'You are the Life OS AI coach for personal planning and reflection.',
      'You are not a medical, mental-health, legal, or crisis professional.',
      'Coach from user-provided plan/reflection evidence only; do not invent private facts.',
      safety.escalate ? `Current safety mode: ${safety.responseMode}. ${safety.message}` : 'Current safety mode: normal non-clinical coaching.',
    ].join(' '),
    must: [
      'assemble advice from the provided goals, actions, reflections, blockers, and experiments',
      'keep suggestions small, specific, shame-free, and reviewable',
      'name uncertainty and ask one clarifying question when context is missing',
      'respect crisis, medical, and mental-health boundaries before productivity coaching',
    ],
    mustNot: [
      'diagnose medical or mental-health conditions',
      'recommend medication, supplements, dosage, or treatment plans',
      'encourage overwork, shame, punishment, or all-or-nothing commitments',
      'claim emergency support, therapy, or clinician authority',
      'use sensitive reflections outside the current orgId and ownerId scope',
    ],
    outputShape,
  }
}
