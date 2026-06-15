import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'
import { canAccessModule, recordScopeFor } from '@/lib/orgMembers/access-policy'

export const PROJECT_MEMBER_ROLES = ['owner', 'manager', 'contributor', 'reviewer', 'viewer'] as const
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number]

export type ProjectPermission = 'manage_access' | 'manage_project' | 'write' | 'review' | 'view'

export interface ProjectAccessContext {
  role: ProjectMemberRole
  source: 'super_admin' | 'ai' | 'project_member' | 'project_organization' | 'legacy_org'
  canViewInternal: boolean
}

export interface ProjectHealthInput {
  tasks?: Array<Record<string, unknown>>
  milestones?: Array<Record<string, unknown>>
  approvals?: Array<Record<string, unknown>>
  now?: Date
}

export interface ProjectTimelineInput {
  tasks?: Array<Record<string, unknown>>
  milestones?: Array<Record<string, unknown>>
  baselines?: Array<Record<string, unknown>>
}

export interface ProjectWorkloadInput {
  tasks?: Array<Record<string, unknown>>
  capacities?: Array<Record<string, unknown>>
}

export interface ProjectReportsInput {
  tasks?: Array<Record<string, unknown>>
  milestones?: Array<Record<string, unknown>>
  approvals?: Array<Record<string, unknown>>
  risks?: Array<Record<string, unknown>>
  revenue?: Array<Record<string, unknown>>
  now?: Date
}

export interface ProjectHealth {
  level: 'healthy' | 'watch' | 'at_risk'
  score: number
  openTasks: number
  blockedTasks: number
  overdueTasks: number
  waitingApprovals: number
  milestoneDrift: number
  agentBlockers: number
}

const ROLE_RANK: Record<ProjectMemberRole, number> = {
  owner: 50,
  manager: 40,
  contributor: 30,
  reviewer: 20,
  viewer: 10,
}

const PERMISSION_MIN_ROLE: Record<ProjectPermission, ProjectMemberRole> = {
  manage_access: 'manager',
  manage_project: 'manager',
  write: 'contributor',
  review: 'reviewer',
  view: 'viewer',
}

export function normalizeProjectRole(value: unknown): ProjectMemberRole {
  return PROJECT_MEMBER_ROLES.includes(value as ProjectMemberRole) ? value as ProjectMemberRole : 'viewer'
}

export function canProjectRole(role: unknown, permission: ProjectPermission): boolean {
  const normalized = normalizeProjectRole(role)
  return ROLE_RANK[normalized] >= ROLE_RANK[PERMISSION_MIN_ROLE[permission]]
}

export function projectMemberDocId(projectId: string, uid: string): string {
  return `${projectId}_${uid}`
}

export function projectOrganizationDocId(projectId: string, orgIdOrCompanyId: string): string {
  return `${projectId}_${orgIdOrCompanyId}`
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function projectOwnerOrgId(data: Record<string, unknown>): string {
  return cleanString(data.ownerOrgId) ||
    cleanString(data.sourceOrgId) ||
    cleanString(data.issuerOrgId) ||
    cleanString(data.orgId)
}

function projectOrgIds(data: Record<string, unknown>): string[] {
  return [
    data.orgId,
    data.sourceOrgId,
    data.issuerOrgId,
    data.ownerOrgId,
    data.clientId,
    data.clientOrgId,
    data.recipientOrgId,
    data.targetOrgId,
  ].map(cleanString).filter(Boolean)
}

function userOrgIds(user: ApiUser): string[] {
  const ids = new Set<string>()
  if (user.orgId) ids.add(user.orgId)
  if (Array.isArray(user.orgIds)) {
    for (const orgId of user.orgIds) if (orgId) ids.add(orgId)
  }
  if (Array.isArray(user.allowedOrgIds)) {
    for (const orgId of user.allowedOrgIds) if (orgId) ids.add(orgId)
  }
  return Array.from(ids)
}

export function userCanViewInternalProjectItems(user: ApiUser, projectData: Record<string, unknown>): boolean {
  if (user.role === 'ai' || isSuperAdmin(user)) return true
  const ownerOrgId = projectOwnerOrgId(projectData)
  return Boolean(ownerOrgId && canAccessOrg(user, ownerOrgId))
}

export function filterInternalItemsForProjectAccess<T extends object>(
  items: T[],
  canViewInternal: boolean,
): T[] {
  if (canViewInternal) return items
  return items.filter((item) => {
    const data = item as { internalOnly?: unknown; visibility?: unknown }
    return data.internalOnly !== true && cleanString(data.visibility) !== 'internal'
  })
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
}

function allowedByRole(role: ProjectMemberRole | undefined, allowedRoles: string[]): boolean {
  if (allowedRoles.length === 0 || !role) return false
  const minimumRank = Math.min(
    ...allowedRoles.map((allowedRole) => ROLE_RANK[normalizeProjectRole(allowedRole)]),
  )
  return ROLE_RANK[normalizeProjectRole(role)] >= minimumRank
}

function hasOverlap(left: string[], right: string[]): boolean {
  return left.some((item) => right.includes(item))
}

function userLinkedToProjectFallback(user: ApiUser, data: Record<string, unknown>): boolean {
  const uid = cleanString(user.uid)
  if (!uid) return false
  if (cleanString(data.ownerUid) === uid) return true
  if (cleanString(data.createdBy) === uid) return true
  if (cleanString(data.managerUid) === uid) return true
  if (cleanString(data.assignedTo) === uid) return true
  return cleanStringArray(data.allowedUserIds).includes(uid) ||
    cleanStringArray(data.memberUids).includes(uid) ||
    cleanStringArray(data.projectMemberUids).includes(uid)
}

export function legacyProjectPolicyAllows(user: ApiUser, data: Record<string, unknown>): boolean {
  if (user.role === 'ai' || isSuperAdmin(user)) return true
  if (!user.memberAccessPolicy) return true
  if (!canAccessModule(user.memberAccessPolicy, 'projects')) return false
  if (recordScopeFor(user.memberAccessPolicy, 'projects') === 'all') return true
  return userLinkedToProjectFallback(user, data)
}

export function filterProjectItemsForAccess<T extends object>(
  items: T[],
  input: { projectAccess?: ProjectAccessContext | null; user?: Pick<ApiUser, 'uid' | 'orgId' | 'orgIds' | 'allowedOrgIds' | 'role'> },
): T[] {
  const projectAccess = input.projectAccess ?? null
  const uid = cleanString(input.user?.uid)
  const orgIds = input.user ? userOrgIds(input.user as ApiUser) : []

  return items.filter((item) => {
    const data = item as Record<string, unknown>
    const visibility = cleanString(data.visibility) || (data.internalOnly === true ? 'internal' : 'project')
    const allowedUserIds = cleanStringArray(data.allowedUserIds)
    const allowedOrgIds = cleanStringArray(data.allowedOrgIds)
    const allowedRoleIds = cleanStringArray(data.allowedRoleIds ?? data.allowedRoles)
    const hasExplicitRules = allowedUserIds.length > 0 || allowedOrgIds.length > 0 || allowedRoleIds.length > 0

    if ((visibility === 'internal' || data.internalOnly === true) && projectAccess?.canViewInternal !== true) {
      return false
    }

    if (visibility === 'external') return true
    if (visibility === 'public' || visibility === 'project') {
      if (!hasExplicitRules) return true
    }

    if (projectAccess?.role === 'owner') return true
    if (uid && (allowedUserIds.includes(uid) || cleanString(data.ownerUid) === uid || cleanString(data.createdBy) === uid)) return true
    if (hasOverlap(orgIds, allowedOrgIds)) return true
    if (allowedByRole(projectAccess?.role, allowedRoleIds)) return true

    return !hasExplicitRules && visibility !== 'restricted' && visibility !== 'private'
  })
}

export function ownerMemberData(input: {
  projectId: string
  uid: string
  orgId: string
  actorUid: string
}): Record<string, unknown> {
  return {
    projectId: input.projectId,
    uid: input.uid,
    orgId: input.orgId,
    role: 'owner',
    status: 'active',
    memberType: 'internal',
    invitedBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export async function ensureProjectOwnerMembership(input: {
  projectId: string
  ownerUid: string
  ownerOrgId: string
  actorUid: string
}): Promise<void> {
  if (!input.projectId || !input.ownerUid || !input.ownerOrgId) return
  await adminDb
    .collection('projectMembers')
    .doc(projectMemberDocId(input.projectId, input.ownerUid))
    .set(ownerMemberData({
      projectId: input.projectId,
      uid: input.ownerUid,
      orgId: input.ownerOrgId,
      actorUid: input.actorUid,
    }), { merge: true })
}

export function legacyProjectAccessForUser(user: ApiUser, data: Record<string, unknown>): ProjectAccessContext | null {
  if (user.role === 'ai') return { role: 'owner', source: 'ai', canViewInternal: true }
  if (isSuperAdmin(user)) return { role: 'owner', source: 'super_admin', canViewInternal: true }
  if (!legacyProjectPolicyAllows(user, data)) return null
  const ids = projectOrgIds(data)
  if (!ids.some((id) => canAccessOrg(user, id))) return null
  const canViewInternal = userCanViewInternalProjectItems(user, data)
  return { role: canViewInternal ? 'manager' : 'contributor', source: 'legacy_org', canViewInternal }
}

export async function resolveProjectAccessForUser(
  projectId: string,
  user: ApiUser,
  projectData: Record<string, unknown>,
): Promise<ProjectAccessContext | null> {
  if (user.role === 'ai') return { role: 'owner', source: 'ai', canViewInternal: true }
  if (isSuperAdmin(user)) return { role: 'owner', source: 'super_admin', canViewInternal: true }

  const memberSnap = await adminDb.collection('projectMembers').doc(projectMemberDocId(projectId, user.uid)).get()
  if (memberSnap.exists) {
    const member = memberSnap.data() ?? {}
    if (member.status !== 'revoked') {
      const role = normalizeProjectRole(member.role)
      const ownerOrgId = projectOwnerOrgId(projectData)
      const memberOrgId = cleanString(member.orgId)
      return {
        role,
        source: 'project_member',
        canViewInternal: member.memberType === 'internal' || (ownerOrgId.length > 0 && memberOrgId === ownerOrgId),
      }
    }
  }

  for (const orgId of userOrgIds(user)) {
    const orgSnap = await adminDb.collection('projectOrganizations').doc(projectOrganizationDocId(projectId, orgId)).get()
    if (!orgSnap.exists) continue
    const orgAccess = orgSnap.data() ?? {}
    if (orgAccess.status === 'revoked' || orgAccess.status === 'pending') continue
    return {
      role: normalizeProjectRole(orgAccess.role),
      source: 'project_organization',
      canViewInternal: false,
    }
  }

  return legacyProjectAccessForUser(user, projectData)
}

function dateMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function isDoneTask(task: Record<string, unknown>): boolean {
  return task.columnId === 'done' || task.status === 'done' || task.agentStatus === 'done'
}

function isBlockedTask(task: Record<string, unknown>): boolean {
  return task.columnId === 'blocked' || task.agentStatus === 'blocked' || (Array.isArray(task.labels) && task.labels.includes('blocked'))
}

export function buildProjectHealth(input: ProjectHealthInput): ProjectHealth {
  const now = input.now ?? new Date()
  const nowMillis = now.getTime()
  const tasks = input.tasks ?? []
  const milestones = input.milestones ?? []
  const approvals = input.approvals ?? []

  const openTasks = tasks.filter((task) => !isDoneTask(task)).length
  const blockedTasks = tasks.filter((task) => isBlockedTask(task) && !isDoneTask(task)).length
  const agentBlockers = tasks.filter((task) => task.agentStatus === 'blocked' && !isDoneTask(task)).length
  const overdueTasks = tasks.filter((task) => {
    if (isDoneTask(task)) return false
    const due = dateMillis(task.dueDate)
    return due > 0 && due < nowMillis
  }).length
  const waitingApprovals = approvals.filter((approval) => {
    const status = cleanString(approval.status) || 'pending'
    return status === 'pending' || status === 'in_review' || status === 'requested'
  }).length
  const milestoneDrift = milestones.filter((milestone) => {
    const status = cleanString(milestone.status)
    if (status === 'done' || status === 'completed') return false
    const due = dateMillis(milestone.dueDate ?? milestone.targetDate ?? milestone.endDate)
    return due > 0 && due < nowMillis
  }).length

  const penalties =
    blockedTasks * 18 +
    overdueTasks * 10 +
    waitingApprovals * 8 +
    milestoneDrift * 12 +
    agentBlockers * 8
  const score = Math.max(0, Math.min(100, 100 - penalties))
  const level: ProjectHealth['level'] = score < 70 || blockedTasks > 0 || milestoneDrift > 0
    ? 'at_risk'
    : score < 88 || overdueTasks > 0 || waitingApprovals > 0
      ? 'watch'
      : 'healthy'

  return {
    level,
    score,
    openTasks,
    blockedTasks,
    overdueTasks,
    waitingApprovals,
    milestoneDrift,
    agentBlockers,
  }
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function timelineDate(value: unknown): unknown {
  if (!value) return null
  return value
}

function driftDays(current: unknown, baseline: unknown): number {
  const currentMillis = dateMillis(current)
  const baselineMillis = dateMillis(baseline)
  if (!currentMillis || !baselineMillis) return 0
  return Math.round((currentMillis - baselineMillis) / (1000 * 60 * 60 * 24))
}

function timelineItem(kind: 'task' | 'milestone', item: Record<string, unknown>) {
  const baselineDueDate = item.baselineDueDate ?? item.baselineEndDate
  const dueDate = item.dueDate ?? item.targetDate ?? item.endDate
  return {
    id: cleanString(item.id),
    kind,
    title: cleanString(item.title) || (kind === 'task' ? 'Untitled task' : 'Untitled milestone'),
    status: cleanString(item.status) || cleanString(item.columnId) || 'active',
    startDate: timelineDate(item.startDate),
    dueDate: timelineDate(dueDate),
    baselineStartDate: timelineDate(item.baselineStartDate),
    baselineDueDate: timelineDate(baselineDueDate),
    ownerUid: cleanString(item.ownerUid),
    dependencies: cleanStringArray(item.dependsOn ?? item.dependencyIds),
    baselineDriftDays: driftDays(dueDate, baselineDueDate),
    internalOnly: item.internalOnly === true,
  }
}

export function buildProjectTimeline(input: ProjectTimelineInput) {
  const taskItems = (input.tasks ?? []).map((task) => timelineItem('task', task))
  const milestoneItems = (input.milestones ?? []).map((milestone) => timelineItem('milestone', milestone))
  const items = [...taskItems, ...milestoneItems].sort((a, b) => {
    const left = dateMillis(a.startDate) || dateMillis(a.dueDate)
    const right = dateMillis(b.startDate) || dateMillis(b.dueDate)
    return left - right
  })

  return {
    items,
    baselines: input.baselines ?? [],
    dependencyCount: items.reduce((total, item) => total + item.dependencies.length, 0),
    driftCount: items.filter((item) => item.baselineDriftDays > 0).length,
  }
}

function taskAssigneeIds(task: Record<string, unknown>): string[] {
  const assigneeIds = cleanStringArray(task.assigneeIds)
  if (assigneeIds.length > 0) return assigneeIds
  const assigneeId = cleanString(task.assigneeId)
  if (assigneeId) return [assigneeId]
  const ownerUid = cleanString(task.ownerUid)
  if (ownerUid) return [ownerUid]
  return ['unassigned']
}

export function buildProjectWorkload(input: ProjectWorkloadInput) {
  const capacityByUid = new Map<string, { name: string; capacityMinutes: number }>()
  for (const capacity of input.capacities ?? []) {
    const uid = cleanString(capacity.uid ?? capacity.userId)
    if (!uid) continue
    capacityByUid.set(uid, {
      name: cleanString(capacity.displayName ?? capacity.name ?? capacity.email) || uid,
      capacityMinutes: numericValue(capacity.capacityMinutes ?? capacity.weeklyMinutes ?? capacity.availableMinutes) || 2400,
    })
  }

  const workloadByUid = new Map<string, { uid: string; name: string; assignedTasks: number; estimateMinutes: number; capacityMinutes: number }>()
  for (const [uid, capacity] of capacityByUid.entries()) {
    workloadByUid.set(uid, {
      uid,
      name: capacity.name,
      assignedTasks: 0,
      estimateMinutes: 0,
      capacityMinutes: capacity.capacityMinutes,
    })
  }

  for (const task of input.tasks ?? []) {
    const estimateMinutes = numericValue(task.estimateMinutes ?? task.estimate ?? task.durationMinutes)
    for (const uid of taskAssigneeIds(task)) {
      const capacity = capacityByUid.get(uid)
      const row = workloadByUid.get(uid) ?? {
        uid,
        name: capacity?.name || uid,
        assignedTasks: 0,
        estimateMinutes: 0,
        capacityMinutes: capacity?.capacityMinutes ?? 2400,
      }
      row.assignedTasks += 1
      row.estimateMinutes += estimateMinutes
      workloadByUid.set(uid, row)
    }
  }

  const assignees = Array.from(workloadByUid.values())
    .map((row) => ({
      ...row,
      utilizationPercent: row.capacityMinutes > 0 ? Math.round((row.estimateMinutes / row.capacityMinutes) * 100) : 0,
      overCapacity: row.capacityMinutes > 0 && row.estimateMinutes > row.capacityMinutes,
      remainingMinutes: Math.max(0, row.capacityMinutes - row.estimateMinutes),
      overByMinutes: Math.max(0, row.estimateMinutes - row.capacityMinutes),
    }))
    .sort((a, b) => b.overByMinutes - a.overByMinutes || b.estimateMinutes - a.estimateMinutes || a.name.localeCompare(b.name))

  return {
    assignees,
    totalEstimateMinutes: assignees.reduce((total, row) => total + row.estimateMinutes, 0),
    totalCapacityMinutes: assignees.reduce((total, row) => total + row.capacityMinutes, 0),
    totalRemainingMinutes: assignees.reduce((total, row) => total + row.remainingMinutes, 0),
    totalOverByMinutes: assignees.reduce((total, row) => total + row.overByMinutes, 0),
    overCapacityCount: assignees.filter((row) => row.overCapacity).length,
    averageUtilizationPercent: assignees.length > 0
      ? Math.round(assignees.reduce((total, row) => total + row.utilizationPercent, 0) / assignees.length)
      : 0,
  }
}

export function buildProjectReports(input: ProjectReportsInput) {
  const now = input.now ?? new Date()
  const nowMillis = now.getTime()
  const tasks = input.tasks ?? []
  const milestones = input.milestones ?? []
  const approvals = input.approvals ?? []
  const risks = input.risks ?? []
  const revenue = input.revenue ?? []
  const trackedAmount = revenue.reduce((total, item) => total + numericValue(item.amount ?? item.value ?? item.total), 0)
  const currency = cleanString(revenue.find((item) => cleanString(item.currency))?.currency) || 'ZAR'

  return {
    tasks: {
      total: tasks.length,
      open: tasks.filter((task) => !isDoneTask(task)).length,
      done: tasks.filter(isDoneTask).length,
      blocked: tasks.filter((task) => isBlockedTask(task) && !isDoneTask(task)).length,
      overdue: tasks.filter((task) => {
        if (isDoneTask(task)) return false
        const due = dateMillis(task.dueDate)
        return due > 0 && due < nowMillis
      }).length,
    },
    milestones: {
      total: milestones.length,
      drift: milestones.filter((milestone) => driftDays(milestone.dueDate ?? milestone.targetDate ?? milestone.endDate, milestone.baselineDueDate ?? milestone.baselineEndDate) > 0).length,
    },
    approvals: {
      total: approvals.length,
      waiting: approvals.filter((approval) => {
        const status = cleanString(approval.status) || 'pending'
        return status === 'pending' || status === 'in_review' || status === 'requested'
      }).length,
    },
    risks: {
      total: risks.length,
      high: risks.filter((risk) => cleanString(risk.severity) === 'high' || cleanString(risk.severity) === 'critical').length,
      open: risks.filter((risk) => {
        const status = cleanString(risk.status) || 'open'
        return status !== 'closed' && status !== 'resolved'
      }).length,
    },
    revenue: {
      trackedAmount,
      currency,
      records: revenue.length,
    },
  }
}
