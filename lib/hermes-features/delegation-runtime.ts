/**
 * Subagent delegation that creates observable Hermes child runs (not just IDs).
 */
import type { HermesFeaturesRepository, DelegationRecord } from './repository'
import { spawnDelegations as spawnPure, completeChild } from './delegation'

export interface DelegationRunDeps {
  createRun: (input: {
    orgId: string
    agentId: string
    conversationId?: string
    goal: string
    childId: string
    parentRunHint: string
  }) => Promise<{ ok: boolean; runId?: string; runDocId?: string; error?: string }>
  now?: () => Date
}

export async function spawnObservableDelegations(
  input: {
    orgId: string
    agentId: string
    conversationId?: string
    parentRunHint: string
    goals: string[]
    maxConcurrent?: number
    toolsets?: string[]
  },
  repo: HermesFeaturesRepository,
  deps: DelegationRunDeps,
): Promise<DelegationRecord> {
  const spawn = spawnPure({
    parentRunHint: input.parentRunHint,
    goals: input.goals,
    maxConcurrent: input.maxConcurrent,
    toolsets: input.toolsets,
  })
  const now = (deps.now?.() ?? new Date()).toISOString()
  const children = []

  for (const child of spawn.children) {
    const result = await deps.createRun({
      orgId: input.orgId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      goal: child.goal,
      childId: child.id,
      parentRunHint: input.parentRunHint,
    })
    children.push({
      ...child,
      status: result.ok ? ('running' as const) : ('failed' as const),
      result: result.ok ? undefined : result.error,
      runId: result.runId,
      runDocId: result.runDocId,
    })
  }

  const record: DelegationRecord = {
    id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orgId: input.orgId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    parentRunHint: input.parentRunHint,
    maxConcurrent: spawn.maxConcurrent,
    children,
    createdAt: now,
    updatedAt: now,
  }
  return repo.saveDelegation(record)
}

export async function observeDelegation(
  orgId: string,
  id: string,
  repo: HermesFeaturesRepository,
): Promise<DelegationRecord | null> {
  return repo.getDelegation(orgId, id)
}

export async function completeDelegationChild(
  orgId: string,
  delegationId: string,
  childId: string,
  result: string,
  ok: boolean,
  repo: HermesFeaturesRepository,
): Promise<DelegationRecord> {
  const record = await repo.getDelegation(orgId, delegationId)
  if (!record) throw new Error('Delegation not found')
  const children = record.children.map((c) => {
    if (c.id !== childId) return c
    return completeChild(c, result, ok)
  })
  return repo.saveDelegation({
    ...record,
    children,
    updatedAt: new Date().toISOString(),
  })
}
