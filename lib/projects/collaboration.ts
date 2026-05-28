import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg, isSuperAdmin } from '@/lib/api/platformAdmin'

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
  return items.filter((item) => (item as { internalOnly?: unknown }).internalOnly !== true)
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
