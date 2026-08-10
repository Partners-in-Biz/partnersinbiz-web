/**
 * AgentOrgNode assignment permissions — who may assign work to whom.
 *
 * Rules (mirror Paperclip's relationship model, kept explicit):
 *  - Humans (role admin / client with org access) may assign to anyone in their org.
 *  - An agent may assign work to another agent only when:
 *      a) the assignee is an ancestor/descendant along the org chain in the permitted
 *         direction (down: manager → report), OR
 *      b) the assignee's delegation allows lateral peer assignment and they share a
 *         manager, OR
 *      c) the assignee's delegation allows anyone (open node), OR
 *      d) escalateToManager is set and the assignee is the assigner's manager (blocked
 *         work handed up), OR
 *      e) the assigner is the assignee itself (self-assignment).
 *  - Assignment to a paused node is refused for everyone except humans.
 */
import type { AgentOrgNode } from './types'
import { arePeers, buildOrgTree, isAncestor } from './tree'

export type OrgActor =
  | { kind: 'human'; uid: string }
  | { kind: 'agent'; agentId: string }

export interface AssignmentDecision {
  allowed: boolean
  reason?: string
}

function findNodeByAgentId(nodes: AgentOrgNode[], agentId: string | null): AgentOrgNode | null {
  if (!agentId) return null
  return nodes.find((n) => n.agentId === agentId) ?? null
}

export function canAssign(
  nodes: AgentOrgNode[],
  actor: OrgActor,
  assigneeAgentId: string | null,
): AssignmentDecision {
  if (!assigneeAgentId) return { allowed: true }
  const assignee = findNodeByAgentId(nodes, assigneeAgentId)
  // No org node for the assignee → no restriction from the org layer.
  if (!assignee) return { allowed: true }

  if (actor.kind === 'human') {
    // Paused node: humans may still assign (they can un-pause themselves; the
    // chart is governance for agents, not a lock on owners).
    return { allowed: true }
  }

  if (assignee.status === 'paused') {
    return { allowed: false, reason: `Agent node '${assignee.id}' is paused; no new work can be assigned by agents.` }
  }

  const tree = buildOrgTree(nodes)
  if (!tree.ok) return { allowed: false, reason: `Org chart is inconsistent: ${tree.error ?? 'cycle'}` }
  const byId = tree.byId

  const actorNode = findNodeByAgentId(nodes, actor.agentId)
  // Actor is not in the chart → treat like a human (unrestricted). The chart governs
  // charted agents; unnamed runtimes keep the existing open model.
  if (!actorNode) return { allowed: true }

  if (assignee.id === actorNode.id) return { allowed: true }

  const delegation = assignee.delegation
  if (delegation.assignableFrom === 'anyone') return { allowed: true }

  if (delegation.assignableFrom === 'manager_only') {
    // Manager (direct or any ancestor) may assign down.
    if (isAncestor(byId, actorNode.id, assignee.id)) return { allowed: true }
    // Escalation: assignee's manager is the actor and escalation is enabled.
    if (assignee.reportsTo === actorNode.id && delegation.escalateToManager) return { allowed: true }
    return { allowed: false, reason: `Agent '${actor.agentId}' may not assign work to '${assignee.id}' (manager_only node).` }
  }

  // manager_and_peers
  if (isAncestor(byId, actorNode.id, assignee.id)) return { allowed: true }
  if (delegation.allowLateral && arePeers(byId, actorNode.id, assignee.id)) return { allowed: true }
  if (assignee.reportsTo === actorNode.id && delegation.escalateToManager) return { allowed: true }
  return { allowed: false, reason: `Agent '${actor.agentId}' may not assign work to '${assignee.id}' (manager_and_peers node).` }
}

/**
 * Describe the assignability rules for a node for UI display.
 */
export function describeAssignability(node: AgentOrgNode): string {
  switch (node.delegation.assignableFrom) {
    case 'anyone':
      return 'Any agent may assign work here'
    case 'manager_only':
      return node.delegation.escalateToManager
        ? 'Manager only (escalations allowed)'
        : 'Manager only'
    case 'manager_and_peers':
      return node.delegation.allowLateral
        ? 'Manager and peers'
        : 'Manager only (peers disabled)'
    default:
      return 'Manager only'
  }
}
