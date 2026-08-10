/**
 * AgentOrgNode — Paperclip-style agent organisation hierarchy for Partners in Biz.
 *
 * An org chart node represents a role in an organisation's agent workforce. It is
 * org-scoped (orgId) and may be bound to a real runtime agent (agentId) or left
 * unbound as a role placeholder. The org chart is governance and discovery, not an
 * auto-router: humans assign work as today; when an agent assigns to another agent,
 * the relationship rules in `delegation` decide who may assign to whom, and the
 * node's `defaultModel`/`defaultEffort` become the task defaults.
 *
 * Storage: Firestore collection `agent_org_nodes`, one doc per node.
 */
import type { AgentEffort, AgentModel } from '@/lib/agents/runRouting'

export const AGENT_ORG_COLLECTION = 'agent_org_nodes'

/** Max capabilities stored per node (UI chip limit). */
export const AGENT_ORG_MAX_CAPABILITIES = 12

export type OrgNodeStatus = 'active' | 'paused'

/** Who may assign new tasks TO this node. */
export type OrgAssignableFrom = 'anyone' | 'manager_only' | 'manager_and_peers'

export interface OrgNodeDelegation {
  /** Who may assign work to this node. */
  assignableFrom: OrgAssignableFrom
  /** Whether the node may hand blocked work up to its reportsTo. */
  escalateToManager: boolean
  /** Whether peers (same reportsTo) may assign when assignableFrom is manager_and_peers. */
  allowLateral: boolean
}

export interface OrgNodeBudget {
  /** Optional monthly USD cap for this node (P3 enforcement; stored now). */
  monthlyLimitUsd?: number
  /** Approximate spend this month (updated by ops; informational now). */
  spentUsd?: number
}

export interface AgentOrgNode {
  id: string
  orgId: string
  /** Bound runtime agent id (e.g. 'theo'); null = unbound role placeholder. */
  agentId: string | null
  /** Display name shown on the chart card. */
  name: string
  /** Role title, e.g. 'Lead Developer'. */
  title: string
  /** Parent node id; null = root. */
  reportsTo: string | null
  /** Derived root → … → parent (ids, excluding self). Used for escalation. */
  chainOfCommand: string[]
  capabilities: string[]
  defaultModel: AgentModel | null
  defaultEffort: AgentEffort | null
  delegation: OrgNodeDelegation
  status: OrgNodeStatus
  budget?: OrgNodeBudget
  iconKey: string
  colorKey: string
  createdAt: unknown
  updatedAt: unknown
}

/** Chart node with derived tree info (computed by buildOrgTree). */
export interface OrgTreeNode extends AgentOrgNode {
  children: OrgTreeNode[]
  depth: number
  descendantIds: string[]
}

export const DEFAULT_ORG_NODE_DELEGATION: OrgNodeDelegation = {
  assignableFrom: 'manager_only',
  escalateToManager: true,
  allowLateral: false,
}

export function isOrgNodeStatus(value: unknown): value is OrgNodeStatus {
  return value === 'active' || value === 'paused'
}

export function isOrgAssignableFrom(value: unknown): value is OrgAssignableFrom {
  return value === 'anyone' || value === 'manager_only' || value === 'manager_and_peers'
}
