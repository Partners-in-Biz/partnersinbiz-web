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
  const tasks = filter(input.tasks)
  const milestones = filter(byName.milestones)
  const approvals = filter(byName.approvals)
  const risks = filter(byName.risks)
  const decisions = filter(byName.decisions)
  const baselines = filter(byName.baselines)
  const playbooks = filter(byName.playbooks)
  const automations = filter(byName.automations)
  const permissions = filter(byName.permissions)
  const notificationSettings = filter(byName.notificationSettings)
  const capacities = filter(byName.capacities)
  const revenue = filter(byName.revenue)

  return {
    planningDiscovery: input.projectData.planningDiscovery ?? null,
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
