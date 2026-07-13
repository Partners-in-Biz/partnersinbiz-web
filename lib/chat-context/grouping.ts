import type { ContextActivitySummary, ContextActivityType } from './types'

export type ActivityImportance = 'routine' | 'interrupting'

const ROUTINE_TYPES = new Set<ContextActivityType>(['pickup', 'running', 'waiting', 'dependency_released'])

export function classifyActivity(activity: ContextActivitySummary): ActivityImportance {
  return ROUTINE_TYPES.has(activity.type) ? 'routine' : 'interrupting'
}

export function groupActivity(activity: ContextActivitySummary[]): Record<ActivityImportance, ContextActivitySummary[]> {
  return activity.reduce<Record<ActivityImportance, ContextActivitySummary[]>>(
    (groups, item) => {
      groups[classifyActivity(item)].push(item)
      return groups
    },
    { routine: [], interrupting: [] },
  )
}
