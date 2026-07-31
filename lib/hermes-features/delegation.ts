import type {
  DelegationChild,
  DelegationGoalInput,
  DelegationSpawnResult,
} from './types'

const DEFAULT_MAX = 3

/** Normalize string goals or structured goal+context inputs for spawn. */
export function normalizeDelegationGoals(
  goals: Array<string | DelegationGoalInput>,
): DelegationGoalInput[] {
  return goals
    .map((entry) => {
      if (typeof entry === 'string') {
        const goal = entry.trim()
        return goal ? { goal } : null
      }
      const goal = typeof entry?.goal === 'string' ? entry.goal.trim() : ''
      if (!goal) return null
      const context = typeof entry.context === 'string' && entry.context.trim()
        ? entry.context.trim()
        : undefined
      const agentId = typeof entry.agentId === 'string' && entry.agentId.trim()
        ? entry.agentId.trim()
        : undefined
      return { goal, ...(context ? { context } : {}), ...(agentId ? { agentId } : {}) }
    })
    .filter((entry): entry is DelegationGoalInput => Boolean(entry))
}

export function spawnDelegations(input: {
  parentRunHint: string
  goals: Array<string | DelegationGoalInput>
  maxConcurrent?: number
  toolsets?: string[]
}): DelegationSpawnResult {
  const maxConcurrent = Math.max(1, Math.min(input.maxConcurrent ?? DEFAULT_MAX, 8))
  const goals = normalizeDelegationGoals(input.goals)
  if (goals.length === 0) throw new Error('At least one delegation goal is required')
  const children: DelegationChild[] = goals.slice(0, maxConcurrent).map((entry, i) => ({
    id: `child_${Date.now()}_${i}`,
    goal: entry.goal,
    ...(entry.context ? { context: entry.context } : {}),
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    status: 'queued',
    toolsets: input.toolsets ? [...input.toolsets] : undefined,
  }))
  return {
    parentRunHint: input.parentRunHint || 'messages-delegation',
    children,
    maxConcurrent,
  }
}

export function markChildRunning(child: DelegationChild): DelegationChild {
  return { ...child, status: 'running' }
}

export function completeChild(child: DelegationChild, result: string, ok = true): DelegationChild {
  return {
    ...child,
    status: ok ? 'done' : 'failed',
    result,
  }
}

/** Mark a child as unknown when the runtime process is lost mid-flight. */
export function markChildUnknown(child: DelegationChild, note?: string): DelegationChild {
  return {
    ...child,
    status: 'unknown',
    result: note || child.result || 'Child run state unknown after runtime interruption',
  }
}

export function delegationDispatchBlock(spawn: DelegationSpawnResult): string {
  return [
    '[Hermes subagent delegation]',
    `maxConcurrent: ${spawn.maxConcurrent}`,
    `parent: ${spawn.parentRunHint}`,
    ...spawn.children.map((c) => {
      const agent = c.agentId ? ` agent=${c.agentId}` : ''
      return `- ${c.id} [${c.status}]${agent}: ${c.goal}`
    }),
    'Spawn concurrent children with isolated context (goal+context only) and restricted toolsets when enabled.',
    'Leaf children do not re-delegate by default; only structured summaries re-enter the parent thread.',
    '',
  ].join('\n')
}
