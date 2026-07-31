import type { DelegationChild, DelegationSpawnResult } from './types'

const DEFAULT_MAX = 3

export function spawnDelegations(input: {
  parentRunHint: string
  goals: string[]
  maxConcurrent?: number
  toolsets?: string[]
}): DelegationSpawnResult {
  const maxConcurrent = Math.max(1, Math.min(input.maxConcurrent ?? DEFAULT_MAX, 8))
  const goals = input.goals.map((g) => g.trim()).filter(Boolean)
  if (goals.length === 0) throw new Error('At least one delegation goal is required')
  const children: DelegationChild[] = goals.slice(0, maxConcurrent).map((goal, i) => ({
    id: `child_${Date.now()}_${i}`,
    goal,
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

export function delegationDispatchBlock(spawn: DelegationSpawnResult): string {
  return [
    '[Hermes subagent delegation]',
    `maxConcurrent: ${spawn.maxConcurrent}`,
    `parent: ${spawn.parentRunHint}`,
    ...spawn.children.map((c) => `- ${c.id} [${c.status}]: ${c.goal}`),
    'Spawn concurrent children with isolated context and restricted toolsets when enabled.',
    '',
  ].join('\n')
}
