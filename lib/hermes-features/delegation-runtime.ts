/**
 * Subagent delegation that creates observable Hermes child runs (not just IDs).
 */
import type { HermesFeaturesRepository, DelegationRecord } from './repository'
import type { DelegationGoalInput } from './types'
import { spawnDelegations as spawnPure, completeChild, markChildUnknown } from './delegation'

export const HERMES_FEATURES_DELEGATION_SOURCE = 'hermes-features-delegation'

export interface DelegationRunDeps {
  createRun: (input: {
    orgId: string
    agentId: string
    conversationId?: string
    goal: string
    context?: string
    childId: string
    parentRunHint: string
    delegationId: string
    branchMessageId?: string
  }) => Promise<{ ok: boolean; runId?: string; runDocId?: string; error?: string }>
  now?: () => Date
}

export function newDelegationId(now = Date.now()): string {
  return `del_${now}_${Math.random().toString(36).slice(2, 8)}`
}

export async function spawnObservableDelegations(
  input: {
    orgId: string
    agentId: string
    conversationId?: string
    branchMessageId?: string
    parentRunHint: string
    goals: Array<string | DelegationGoalInput>
    maxConcurrent?: number
    toolsets?: string[]
    /** Optional stable id for tests / pre-linking branch messages. */
    delegationId?: string
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
  const nowDate = deps.now?.() ?? new Date()
  const now = nowDate.toISOString()
  const delegationId = input.delegationId || newDelegationId(nowDate.getTime())
  const children = []

  for (const child of spawn.children) {
    const childAgentId = child.agentId || input.agentId
    const result = await deps.createRun({
      orgId: input.orgId,
      agentId: childAgentId,
      conversationId: input.conversationId,
      goal: child.goal,
      ...(child.context ? { context: child.context } : {}),
      childId: child.id,
      parentRunHint: input.parentRunHint,
      delegationId,
      ...(input.branchMessageId ? { branchMessageId: input.branchMessageId } : {}),
    })
    children.push({
      ...child,
      agentId: childAgentId,
      status: result.ok ? ('running' as const) : ('failed' as const),
      result: result.ok ? undefined : result.error,
      runId: result.runId,
      runDocId: result.runDocId,
    })
  }

  const record: DelegationRecord = {
    id: delegationId,
    orgId: input.orgId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    ...(input.branchMessageId ? { branchMessageId: input.branchMessageId } : {}),
    parentRunHint: input.parentRunHint,
    maxConcurrent: spawn.maxConcurrent,
    children,
    createdAt: now,
    updatedAt: now,
  }
  return repo.saveDelegation(record)
}

/** Attach the parent-thread branch card message after spawn. */
export async function attachDelegationBranchMessage(
  orgId: string,
  delegationId: string,
  branchMessageId: string,
  repo: HermesFeaturesRepository,
): Promise<DelegationRecord> {
  const record = await repo.getDelegation(orgId, delegationId)
  if (!record) throw new Error('Delegation not found')
  return repo.saveDelegation({
    ...record,
    branchMessageId,
    updatedAt: new Date().toISOString(),
  })
}

export async function markDelegationChildUnknown(
  orgId: string,
  delegationId: string,
  childId: string,
  note: string | undefined,
  repo: HermesFeaturesRepository,
): Promise<DelegationRecord> {
  const record = await repo.getDelegation(orgId, delegationId)
  if (!record) throw new Error('Delegation not found')
  const children = record.children.map((c) => (
    c.id === childId ? markChildUnknown(c, note) : c
  ))
  return repo.saveDelegation({
    ...record,
    children,
    updatedAt: new Date().toISOString(),
  })
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
