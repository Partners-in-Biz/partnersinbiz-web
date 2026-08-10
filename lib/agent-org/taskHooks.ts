/**
 * AgentOrgNode task hooks — the single integration point between org charts and
 * task creation/assignment. Call from task routes when a task carries
 * assigneeAgentId:
 *
 *   1. Resolve default agentModel / agentEffort from the assignee's org node
 *      (only fills when the route has NOT set an explicit value).
 *   2. Enforce assignment relationships (canAssign) for agent actors.
 *
 * When the org has no org-chart nodes configured, both steps are no-ops and
 * existing behaviour is preserved exactly (open assignment, no defaults).
 */
import type { ApiUser } from '@/lib/api/types'
import { isPureAgentCaller } from '@/lib/api/actor'
import { listOrgNodes } from './store'
import { canAssign, type OrgActor } from './permissions'
import type { AgentOrgNode } from './types'
import { cleanAgentEffort, cleanAgentModel } from '@/lib/agents/runRouting'

export interface OrgTaskHookResult {
  ok: boolean
  status?: number
  error?: string
  /** Node defaults when the assignee has an org node (null when none). */
  defaults?: { agentModel: string | null; agentEffort: string | null } | null
}

/** Derive the org-chart actor from an authenticated API user. */
export function orgActorFromUser(user: ApiUser | null | undefined): OrgActor {
  if (user && isPureAgentCaller(user)) {
    const agentId =
      (typeof user.agentId === 'string' && user.agentId.trim())
        ? user.agentId.trim()
        : (typeof user.uid === 'string' && user.uid.startsWith('agent:'))
          ? user.uid.slice('agent:'.length).trim()
          : ''
    if (agentId) return { kind: 'agent', agentId }
  }
  return { kind: 'human', uid: user?.uid ?? 'unknown' }
}

/**
 * Run the org-chart gate for a task assignee: permission + defaults.
 *
 * - Returns ok:false (403) when an agent actor may not assign to the target.
 * - Returns defaults only when a node exists for the assignee.
 * - No-ops (ok:true, defaults:null) when the org has no chart or no node.
 */
export async function applyOrgChartToAssignment(opts: {
  orgId: string
  user: ApiUser | null | undefined
  assigneeAgentId: string | null | undefined
}): Promise<OrgTaskHookResult> {
  const { orgId, user, assigneeAgentId } = opts
  if (!assigneeAgentId) return { ok: true, defaults: null }

  const nodes: AgentOrgNode[] = await listOrgNodes(orgId)
  if (nodes.length === 0) return { ok: true, defaults: null }

  // Permission gate for agent actors (humans are unrestricted owners).
  if (user) {
    const actor = orgActorFromUser(user)
    if (actor.kind === 'agent') {
      const decision = canAssign(nodes, actor, assigneeAgentId)
      if (!decision.allowed) {
        return { ok: false, status: 403, error: decision.reason ?? 'Agent relationship does not permit this assignment' }
      }
    }
  }

  const node = nodes.find((n) => n.agentId === assigneeAgentId) ?? null
  if (!node) return { ok: true, defaults: null }

  const agentModel = cleanAgentModel(node.defaultModel)
  const agentEffort = cleanAgentEffort(node.defaultEffort)
  if (!agentModel && (!agentEffort || agentEffort === 'none')) return { ok: true, defaults: null }
  return {
    ok: true,
    defaults: {
      agentModel: agentModel ?? null,
      agentEffort: agentEffort && agentEffort !== 'none' ? agentEffort : null,
    },
  }
}

/** Fill empty agentModel/agentEffort fields on a task field bag from node defaults. */
export function applyOrgDefaultsToTaskFields(
  task: { agentModel?: string | null; agentEffort?: string | null },
  defaults: OrgTaskHookResult['defaults'] | null | undefined,
): { appliedModel: boolean; appliedEffort: boolean } {
  const result = { appliedModel: false, appliedEffort: false }
  if (!defaults) return result
  if ((!task.agentModel || task.agentModel === '') && defaults.agentModel) {
    task.agentModel = defaults.agentModel
    result.appliedModel = true
  }
  if ((!task.agentEffort || task.agentEffort === '') && defaults.agentEffort) {
    task.agentEffort = defaults.agentEffort
    result.appliedEffort = true
  }
  return result
}
