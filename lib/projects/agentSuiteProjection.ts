import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import {
  buildProjectHealth,
  buildProjectReports,
  buildProjectTimeline,
  buildProjectWorkload,
  filterProjectItemsForAccess,
  type ProjectAccessContext,
} from '@/lib/projects/collaboration'

export type AgentSuiteRecord = Record<string, unknown> & { id: string }

const COLLECTIONS = [
  'milestones', 'approvals', 'risks', 'decisions', 'baselines', 'playbooks',
  'automations', 'permissions', 'notificationSettings', 'capacities', 'revenue',
] as const

function cleanString(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function cleanStringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [] }
function mergeStringArrays(...values: unknown[]): string[] { return Array.from(new Set(values.flatMap(cleanStringArray))) }
const VISIBILITY_RANK: Record<string, number> = { public: 0, external: 1, project: 2, internal: 3, restricted: 4, private: 5 }
function mostRestrictiveVisibility(current: unknown, next: unknown): string | undefined {
  const currentValue = cleanString(current)
  const nextValue = cleanString(next)
  if (!currentValue) return nextValue || undefined
  if (!nextValue) return currentValue
  return (VISIBILITY_RANK[nextValue] ?? 2) > (VISIBILITY_RANK[currentValue] ?? 2) ? nextValue : currentValue
}

export function applyAgentPermissionPolicies<T extends AgentSuiteRecord>(items: T[], policies: AgentSuiteRecord[], itemType: string): T[] {
  return items.map((item) => {
    const matching = policies.filter((policy) => {
      if (policy.deleted === true || policy.status === 'archived' || policy.status === 'revoked') return false
      const targetType = cleanString(policy.itemType ?? policy.targetType ?? policy.resourceType)
      if (!targetType || (targetType !== itemType && targetType !== '*')) return false
      const targetId = cleanString(policy.itemId ?? policy.targetId ?? policy.resourceId)
      return !targetId || targetId === item.id
    })
    if (matching.length === 0) return item
    const next: AgentSuiteRecord = { ...item }
    for (const policy of matching) {
      const visibility = mostRestrictiveVisibility(next.visibility, policy.visibility)
      if (visibility) next.visibility = visibility
      if (policy.internalOnly === true) next.internalOnly = true
      next.allowedUserIds = mergeStringArrays(next.allowedUserIds, policy.allowedUserIds)
      next.allowedOrgIds = mergeStringArrays(next.allowedOrgIds, policy.allowedOrgIds)
      next.allowedRoleIds = mergeStringArrays(next.allowedRoleIds, policy.allowedRoleIds, policy.allowedRoles)
      next.permissionPolicyIds = mergeStringArrays(next.permissionPolicyIds, [policy.id])
    }
    return next as T
  })
}

async function list(projectId: string, name: string): Promise<AgentSuiteRecord[]> {
  const snap = await adminDb.collection('projects').doc(projectId).collection(name).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() })).filter((item: Record<string, unknown>) => item.deleted !== true)
}

export async function loadAgentProjectPlan(input: {
  projectId: string
  projectData: Record<string, unknown>
  tasks: AgentSuiteRecord[]
  user: ApiUser
  projectAccess: ProjectAccessContext | null
}) {
  const rows = await Promise.all(COLLECTIONS.map((name) => list(input.projectId, name)))
  const byName = Object.fromEntries(COLLECTIONS.map((name, index) => [name, rows[index]])) as Record<(typeof COLLECTIONS)[number], AgentSuiteRecord[]>
  const filter = <T extends object>(items: T[]) => filterProjectItemsForAccess(items, { projectAccess: input.projectAccess, user: input.user })
  const policies = byName.permissions
  const tasks = filter(applyAgentPermissionPolicies(input.tasks, policies, 'task'))
  const milestones = filter(applyAgentPermissionPolicies(byName.milestones, policies, 'milestone'))
  const approvals = filter(applyAgentPermissionPolicies(byName.approvals, policies, 'approval'))
  const risks = filter(applyAgentPermissionPolicies(byName.risks, policies, 'risk'))
  const decisions = filter(applyAgentPermissionPolicies(byName.decisions, policies, 'decision'))
  const baselines = filter(applyAgentPermissionPolicies(byName.baselines, policies, 'baseline'))
  const playbooks = filter(applyAgentPermissionPolicies(byName.playbooks, policies, 'playbook'))
  const automations = filter(applyAgentPermissionPolicies(byName.automations, policies, 'automation'))
  const permissions = filter(byName.permissions)
  const notificationSettings = filter(applyAgentPermissionPolicies(byName.notificationSettings, policies, 'notification'))
  const capacities = filter(applyAgentPermissionPolicies(byName.capacities, policies, 'capacity'))
  const revenue = filter(applyAgentPermissionPolicies(byName.revenue, policies, 'revenue'))

  return {
    planningDiscovery: input.projectData.planningDiscovery ?? null,
    tasks,
    health: buildProjectHealth({ tasks, milestones, approvals }),
    timeline: buildProjectTimeline({ tasks, milestones, baselines }),
    workload: buildProjectWorkload({ tasks, capacities }),
    reports: buildProjectReports({ tasks, milestones, approvals, risks, revenue }),
    milestones,
    approvals,
    risks,
    decisions,
    baselines,
    playbooks,
    automations,
    permissions,
    notificationSettings,
    capacities,
    revenue,
  }
}
