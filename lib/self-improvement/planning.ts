export type PlanningItemState = 'active' | 'edited' | 'archived' | 'reordered' | 'recovery'

export type DailyActionStatus = 'planned' | 'done' | 'missed' | 'skipped'

export type RecoveryAction = 'recommit' | 'reschedule' | 'shrink' | 'archive'

export interface RecoveryOption {
  action: RecoveryAction
  label: string
  description: string
}

export interface MissedActionRecovery {
  reason: string
  recoveryDate: string
  options: RecoveryOption[]
}

export interface VisionInput {
  id: string
  title: string
  horizon: string
  domains?: string[]
  quarterlyOutcomes: QuarterlyOutcomeInput[]
}

export interface QuarterlyOutcomeInput {
  id: string
  title: string
  targetMetric?: string
  weeklyCommitments: WeeklyCommitmentInput[]
}

export interface WeeklyCommitmentInput {
  id: string
  title: string
  cadence?: string
  dailyActions: DailyActionInput[]
}

export interface DailyActionInput {
  id: string
  title: string
  date: string
  status: DailyActionStatus
}

export interface PlanningVision {
  id: string
  title: string
  horizon: string
  domains: string[]
  state: PlanningItemState
}

export interface QuarterlyOutcome {
  id: string
  title: string
  targetMetric?: string
  order: number
  state: PlanningItemState
}

export interface WeeklyCommitment {
  id: string
  quarterlyOutcomeId: string
  title: string
  cadence: string
  order: number
  state: PlanningItemState
}

export interface DailyAction {
  id: string
  quarterlyOutcomeId: string
  weeklyCommitmentId: string
  title: string
  date: string
  status: DailyActionStatus
  order: number
  state: PlanningItemState
  recovery?: MissedActionRecovery
}

export interface ReviewProgress {
  totalActions: number
  completedActions: number
  missedActions: number
  completionRate: number
  recoveryQueue: string[]
  nextReviewPrompt: string
}

export interface GoalBreakdownPlan {
  vision: PlanningVision
  quarterlyOutcomes: QuarterlyOutcome[]
  weeklyCommitments: WeeklyCommitment[]
  dailyActions: DailyAction[]
  activeQuarterlyOutcomes: QuarterlyOutcome[]
  activeWeeklyCommitments: WeeklyCommitment[]
  activeDailyActions: DailyAction[]
  reviewProgress: ReviewProgress
}

type PlanningCollection = 'quarterlyOutcome' | 'weeklyCommitment' | 'dailyAction'

const recoveryOptions: RecoveryOption[] = [
  {
    action: 'recommit',
    label: 'Recommit',
    description: 'Keep the action as-is and recommit to the next available focus block.',
  },
  {
    action: 'reschedule',
    label: 'Reschedule',
    description: 'Move the action to a specific recovery date without breaking the weekly commitment.',
  },
  {
    action: 'shrink',
    label: 'Shrink',
    description: 'Convert the action into a smaller minimum viable version that preserves momentum.',
  },
  {
    action: 'archive',
    label: 'Archive',
    description: 'Archive the action if it no longer serves the current outcome.',
  },
]

export function buildGoalBreakdown(input: VisionInput): GoalBreakdownPlan {
  const quarterlyOutcomes: QuarterlyOutcome[] = input.quarterlyOutcomes.map((outcome, outcomeIndex) => ({
    id: outcome.id,
    title: outcome.title,
    targetMetric: outcome.targetMetric,
    order: outcomeIndex,
    state: 'active',
  }))

  const weeklyCommitments: WeeklyCommitment[] = input.quarterlyOutcomes.flatMap((outcome, outcomeIndex) =>
    outcome.weeklyCommitments.map((commitment, commitmentIndex) => ({
      id: commitment.id,
      quarterlyOutcomeId: outcome.id,
      title: commitment.title,
      cadence: commitment.cadence ?? 'weekly',
      order: outcomeIndex * 100 + commitmentIndex,
      state: 'active' as PlanningItemState,
    })),
  )

  const dailyActions: DailyAction[] = input.quarterlyOutcomes.flatMap((outcome, outcomeIndex) =>
    outcome.weeklyCommitments.flatMap((commitment, commitmentIndex) =>
      commitment.dailyActions.map((action, actionIndex) => ({
        id: action.id,
        quarterlyOutcomeId: outcome.id,
        weeklyCommitmentId: commitment.id,
        title: action.title,
        date: action.date,
        status: action.status,
        order: outcomeIndex * 1000 + commitmentIndex * 100 + actionIndex,
        state: 'active' as PlanningItemState,
      })),
    ),
  )

  return withDerivedState({
    vision: {
      id: input.id,
      title: input.title,
      horizon: input.horizon,
      domains: input.domains ?? [],
      state: 'active',
    },
    quarterlyOutcomes,
    weeklyCommitments,
    dailyActions,
  })
}

export function updatePlanningItemTitle(
  plan: GoalBreakdownPlan,
  collection: PlanningCollection,
  id: string,
  title: string,
): GoalBreakdownPlan {
  return updateCollection(plan, collection, (item) =>
    item.id === id ? { ...item, title, state: item.state === 'archived' ? 'archived' : 'edited' } : item,
  )
}

export function archivePlanningItem(
  plan: GoalBreakdownPlan,
  collection: PlanningCollection,
  id: string,
): GoalBreakdownPlan {
  return updateCollection(plan, collection, (item) => (item.id === id ? { ...item, state: 'archived' } : item))
}

export function reorderPlanningItems(
  plan: GoalBreakdownPlan,
  collection: PlanningCollection,
  orderedIds: string[],
): GoalBreakdownPlan {
  const orderLookup = new Map(orderedIds.map((id, index) => [id, index]))

  return updateCollection(plan, collection, (item) => {
    const nextOrder = orderLookup.get(item.id)
    if (nextOrder === undefined) return item

    return {
      ...item,
      order: nextOrder,
      state: item.state === 'archived' ? 'archived' : 'reordered',
    }
  })
}

export function markDailyActionMissed(
  plan: GoalBreakdownPlan,
  actionId: string,
  recovery: { reason: string; recoveryDate: string },
): GoalBreakdownPlan {
  return updateCollection(plan, 'dailyAction', (action) =>
    action.id === actionId
      ? {
          ...action,
          status: 'missed',
          state: 'recovery',
          recovery: {
            ...recovery,
            options: recoveryOptions,
          },
        }
      : action,
  )
}

function updateCollection(
  plan: GoalBreakdownPlan,
  collection: PlanningCollection,
  updater: (item: any) => any,
): GoalBreakdownPlan {
  if (collection === 'quarterlyOutcome') {
    return withDerivedState({ ...plan, quarterlyOutcomes: plan.quarterlyOutcomes.map(updater) })
  }

  if (collection === 'weeklyCommitment') {
    return withDerivedState({ ...plan, weeklyCommitments: plan.weeklyCommitments.map(updater) })
  }

  return withDerivedState({ ...plan, dailyActions: plan.dailyActions.map(updater) })
}

function withDerivedState(plan: Omit<GoalBreakdownPlan, 'activeQuarterlyOutcomes' | 'activeWeeklyCommitments' | 'activeDailyActions' | 'reviewProgress'>): GoalBreakdownPlan {
  const quarterlyOutcomes = [...plan.quarterlyOutcomes].sort(byOrder)
  const weeklyCommitments = [...plan.weeklyCommitments].sort(byOrder)
  const dailyActions = [...plan.dailyActions].sort(byOrder)

  return {
    ...plan,
    quarterlyOutcomes,
    weeklyCommitments,
    dailyActions,
    activeQuarterlyOutcomes: quarterlyOutcomes.filter(isActive),
    activeWeeklyCommitments: weeklyCommitments.filter(isActive),
    activeDailyActions: dailyActions.filter(isActive),
    reviewProgress: buildReviewProgress(dailyActions, weeklyCommitments),
  }
}

function buildReviewProgress(dailyActions: DailyAction[], weeklyCommitments: WeeklyCommitment[]): ReviewProgress {
  const activeActions = dailyActions.filter(isActive)
  const completedActions = activeActions.filter((action) => action.status === 'done').length
  const missedActions = activeActions.filter((action) => action.status === 'missed').length
  const recoveryQueue = activeActions.filter((action) => action.state === 'recovery').map((action) => action.id)
  const nextOpenAction = activeActions.find((action) => action.status === 'planned' || action.status === 'missed')
  const parentCommitment = nextOpenAction
    ? weeklyCommitments.find((commitment) => commitment.id === nextOpenAction.weeklyCommitmentId)
    : undefined

  return {
    totalActions: activeActions.length,
    completedActions,
    missedActions,
    completionRate: activeActions.length === 0 ? 0 : completedActions / activeActions.length,
    recoveryQueue,
    nextReviewPrompt: parentCommitment
      ? `Review progress on "${parentCommitment.title}" and choose the next honest action.`
      : 'Review what changed this week and set the next honest commitment.',
  }
}

function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order
}

function isActive<T extends { state: PlanningItemState }>(item: T) {
  return item.state !== 'archived'
}
