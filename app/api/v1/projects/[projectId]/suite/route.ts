import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { normalizeProjectPlaybookTemplate, runProjectPlaybookTemplate, validateProjectPlaybookTemplate } from '@/lib/projects/playbooks'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'
import {
  buildProjectHealth,
  buildProjectReports,
  buildProjectTimeline,
  buildProjectWorkload,
  canProjectRole,
  filterProjectItemsForAccess,
  type ProjectMemberRole,
} from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }
type SuiteType =
  | 'milestone'
  | 'approval'
  | 'risk'
  | 'decision'
  | 'baseline'
  | 'playbook'
  | 'automation'
  | 'permission'
  | 'audit'
  | 'notification'
  | 'capacity'
  | 'revenue'
type SuiteRecord = Record<string, unknown> & { id: string; deleted?: unknown }
type SuiteEventType = 'suite_created' | 'suite_updated' | 'suite_archived' | 'playbook_run'

const PROJECT_ROLE_RANK: Record<ProjectMemberRole, number> = {
  owner: 50,
  manager: 40,
  contributor: 30,
  reviewer: 20,
  viewer: 10,
}

const COLLECTION_BY_TYPE: Record<SuiteType, string> = {
  milestone: 'milestones',
  approval: 'approvals',
  risk: 'risks',
  decision: 'decisions',
  baseline: 'baselines',
  playbook: 'playbooks',
  automation: 'automations',
  permission: 'permissions',
  audit: 'audit',
  notification: 'notificationSettings',
  capacity: 'capacities',
  revenue: 'revenue',
}

const MANAGER_SUITE_TYPES = new Set<SuiteType>([
  'baseline',
  'playbook',
  'automation',
  'permission',
  'notification',
  'capacity',
  'revenue',
])

const PLANNING_SENSITIVE_TYPES = new Set<SuiteType>([
  'milestone',
  'approval',
  'risk',
  'decision',
  'baseline',
  'playbook',
  'automation',
  'permission',
  'notification',
  'capacity',
  'revenue',
])

function applyPlanningMutation(
  tx: FirebaseFirestore.Transaction,
  projectRef: FirebaseFirestore.DocumentReference,
  projectId: string,
  project: Record<string, unknown>,
  actorUid: string,
  reason: string,
) {
  const transition = planningContextMutationTransition(project, {
    uid: actorUid,
    now: new Date().toISOString(),
    reason,
  })
  if (transition.state) {
    tx.update(projectRef, { planningDiscovery: transition.state, updatedAt: FieldValue.serverTimestamp() })
  }
  if (transition.event) {
    tx.set(projectRef.collection('planningDiscoveryEvents').doc(), {
      ...transition.event,
      projectId,
      orgId: project.orgId ?? null,
      schemaVersion: 1,
      reason,
    })
  }
  return transition
}

function suiteMutationRequiresPlanning(type: SuiteType): boolean {
  return PLANNING_SENSITIVE_TYPES.has(type)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => cleanString(item))
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
}

function cleanBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function mergeStringArrays(...values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap((value) => cleanStringArray(value))))
}

const VISIBILITY_RANK: Record<string, number> = {
  public: 0,
  external: 1,
  project: 2,
  internal: 3,
  restricted: 4,
  private: 5,
}

function mostRestrictiveVisibility(current: unknown, next: unknown): string | undefined {
  const currentValue = cleanString(current)
  const nextValue = cleanString(next)
  if (!currentValue) return nextValue || undefined
  if (!nextValue) return currentValue
  return (VISIBILITY_RANK[nextValue] ?? 2) > (VISIBILITY_RANK[currentValue] ?? 2) ? nextValue : currentValue
}

function permissionTargetType(policy: Record<string, unknown>): string {
  return cleanString(policy.itemType ?? policy.targetType ?? policy.resourceType)
}

function permissionTargetId(policy: Record<string, unknown>): string {
  return cleanString(policy.itemId ?? policy.targetId ?? policy.resourceId)
}

function applyPermissionPolicies<T extends SuiteRecord>(
  items: T[],
  policies: SuiteRecord[],
  itemType: string,
): T[] {
  return items.map((item) => {
    const matchingPolicies = policies.filter((policy) => {
      if (policy.deleted === true || policy.status === 'archived' || policy.status === 'revoked') return false
      const targetType = permissionTargetType(policy)
      if (!targetType) return false
      if (targetType && targetType !== itemType && targetType !== '*') return false
      const targetId = permissionTargetId(policy)
      return !targetId || targetId === item.id
    })
    if (matchingPolicies.length === 0) return item

    const next: SuiteRecord = { ...item }
    for (const policy of matchingPolicies) {
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

async function listSubcollection(projectId: string, collectionName: string): Promise<SuiteRecord[]> {
  const snap = await adminDb.collection('projects').doc(projectId).collection(collectionName).get()
  return snap.docs
    .map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }) as SuiteRecord)
    .filter((item) => item.deleted !== true)
}

function permissionForSuiteType(type: SuiteType) {
  return MANAGER_SUITE_TYPES.has(type) ? 'manage_project' : 'write'
}

function suiteMutableFields(
  body: Record<string, unknown>,
  type: SuiteType,
  userUid: string,
  mode: 'create' | 'update',
) {
  const record: Record<string, unknown> = {}
  const isCreate = mode === 'create'

  if (isCreate || hasOwn(body, 'title')) {
    const title = cleanString(body.title)
    if (!title) return { ok: false as const, error: isCreate ? 'title is required' : 'title cannot be empty' }
    record.title = title
  }
  if (isCreate || hasOwn(body, 'description')) record.description = cleanString(body.description)
  if (isCreate || hasOwn(body, 'status')) record.status = cleanString(body.status) || (type === 'risk' ? 'open' : type === 'decision' ? 'proposed' : 'active')
  if (isCreate || hasOwn(body, 'ownerUid')) record.ownerUid = cleanString(body.ownerUid) || userUid
  if (isCreate || hasOwn(body, 'startDate')) record.startDate = cleanString(body.startDate) || null
  if (isCreate || hasOwn(body, 'dueDate')) record.dueDate = cleanString(body.dueDate) || null
  if (isCreate || hasOwn(body, 'endDate')) record.endDate = cleanString(body.endDate) || null
  if (isCreate || hasOwn(body, 'baselineStartDate')) record.baselineStartDate = cleanString(body.baselineStartDate) || null
  if (isCreate || hasOwn(body, 'baselineDueDate')) record.baselineDueDate = cleanString(body.baselineDueDate) || null
  if (isCreate || hasOwn(body, 'severity')) record.severity = cleanString(body.severity) || undefined
  if (isCreate || hasOwn(body, 'trigger')) record.trigger = cleanString(body.trigger) || undefined
  if (isCreate || hasOwn(body, 'cadence')) record.cadence = cleanString(body.cadence) || undefined
  if (isCreate || hasOwn(body, 'templateId')) record.templateId = cleanString(body.templateId) || undefined
  if (type === 'permission' || type === 'notification') {
    if (isCreate || hasOwn(body, 'itemType') || hasOwn(body, 'targetType') || hasOwn(body, 'resourceType')) {
      record.itemType = cleanString(body.itemType ?? body.targetType ?? body.resourceType) || undefined
    }
    if (isCreate || hasOwn(body, 'itemId') || hasOwn(body, 'targetId') || hasOwn(body, 'resourceId')) {
      record.itemId = cleanString(body.itemId ?? body.targetId ?? body.resourceId) || undefined
    }
  }
  if (type === 'notification') {
    if (isCreate || hasOwn(body, 'eventType')) record.eventType = cleanString(body.eventType) || undefined
    if (isCreate || hasOwn(body, 'recipientRoleIds')) record.recipientRoleIds = cleanStringArray(body.recipientRoleIds)
    if (isCreate || hasOwn(body, 'recipientUserIds')) record.recipientUserIds = cleanStringArray(body.recipientUserIds)
    if (isCreate || hasOwn(body, 'recipientOrgIds')) record.recipientOrgIds = cleanStringArray(body.recipientOrgIds)
    if (isCreate || hasOwn(body, 'enabled')) record.enabled = isCreate && !hasOwn(body, 'enabled') ? true : cleanBoolean(body.enabled)
  }
  if (type === 'playbook') {
    if (isCreate || hasOwn(body, 'templateKind')) record.templateKind = cleanString(body.templateKind) || undefined
    if (isCreate || hasOwn(body, 'recurrenceRule')) record.recurrenceRule = cleanString(body.recurrenceRule) || undefined
    if (isCreate || hasOwn(body, 'nextRunAt')) record.nextRunAt = cleanString(body.nextRunAt) || null
    if (isCreate || hasOwn(body, 'autoCreateTasks')) record.autoCreateTasks = cleanBoolean(body.autoCreateTasks)
    if (isCreate || hasOwn(body, 'templateSteps')) record.templateSteps = cleanStringArray(body.templateSteps)
    if (hasOwn(body, 'template')) {
      const template = normalizeProjectPlaybookTemplate(body.template)
      const validation = validateProjectPlaybookTemplate(template)
      if (!validation.ok) return { ok: false as const, error: validation.error }
      record.template = template
      record.templateSchemaVersion = template.schemaVersion
    }
  }
  if (isCreate || hasOwn(body, 'channel')) record.channel = cleanString(body.channel) || undefined
  if (isCreate || hasOwn(body, 'visibility') || hasOwn(body, 'internalOnly')) {
    record.visibility = cleanString(body.visibility) || (body.internalOnly === true ? 'internal' : 'project')
  }
  if (isCreate || hasOwn(body, 'allowedUserIds')) record.allowedUserIds = cleanStringArray(body.allowedUserIds)
  if (isCreate || hasOwn(body, 'allowedOrgIds')) record.allowedOrgIds = cleanStringArray(body.allowedOrgIds)
  if (isCreate || hasOwn(body, 'allowedRoleIds')) record.allowedRoleIds = cleanStringArray(body.allowedRoleIds)
  if (isCreate || hasOwn(body, 'dependsOn') || hasOwn(body, 'dependencyIds')) record.dependsOn = cleanStringArray(body.dependsOn ?? body.dependencyIds)
  if (isCreate || hasOwn(body, 'notificationChannels')) record.notificationChannels = cleanStringArray(body.notificationChannels)
  if (isCreate || hasOwn(body, 'reviewerIds')) record.reviewerIds = cleanStringArray(body.reviewerIds)
  if (isCreate || hasOwn(body, 'linkedTaskIds')) record.linkedTaskIds = cleanStringArray(body.linkedTaskIds)
  if (isCreate || hasOwn(body, 'amount')) record.amount = cleanNumber(body.amount)
  if (isCreate || hasOwn(body, 'currency')) record.currency = cleanString(body.currency) || undefined
  if (isCreate || hasOwn(body, 'capacityMinutes') || hasOwn(body, 'weeklyMinutes')) record.capacityMinutes = cleanNumber(body.capacityMinutes ?? body.weeklyMinutes)
  if (type === 'capacity') {
    if (isCreate || hasOwn(body, 'uid') || hasOwn(body, 'userId')) {
      const uid = cleanString(body.uid ?? body.userId)
      if (!uid && isCreate) return { ok: false as const, error: 'uid is required for capacity records' }
      if (uid) record.uid = uid
    }
    if (isCreate || hasOwn(body, 'displayName') || hasOwn(body, 'name') || hasOwn(body, 'email')) {
      const displayName = cleanString(body.displayName ?? body.name ?? body.email)
      if (displayName) record.displayName = displayName
    }
  }
  if (hasOwn(body, 'internalOnly')) record.internalOnly = body.internalOnly === true
  if (isCreate) {
    record.type = type
    record.internalOnly = body.internalOnly === true
    record.createdBy = userUid
    record.createdAt = FieldValue.serverTimestamp()
  }
  record.updatedBy = userUid
  record.updatedAt = FieldValue.serverTimestamp()

  const toWrite = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
  if (!isCreate && Object.keys(toWrite).length <= 2) {
    return { ok: false as const, error: 'No editable suite fields provided' }
  }
  return { ok: true as const, value: toWrite }
}

async function writeSuiteAudit(input: {
  projectId: string
  eventType: SuiteEventType
  type: SuiteType
  itemId: string
  title?: string
  actorUid: string
  metadata?: Record<string, unknown>
}) {
  if (input.type === 'audit') return
  await adminDb.collection('projects').doc(input.projectId).collection('audit').add({
    type: 'audit',
    eventType: input.eventType,
    itemType: input.type,
    itemId: input.itemId,
    title: input.title || `${input.type} ${input.eventType.replace('suite_', '')}`,
    actorUid: input.actorUid,
    ...(input.metadata ?? {}),
    createdAt: FieldValue.serverTimestamp(),
  })
}

function projectOwnerOrgId(data: Record<string, unknown>): string {
  return cleanString(data.ownerOrgId) || cleanString(data.sourceOrgId) || cleanString(data.issuerOrgId) || cleanString(data.orgId)
}

function lifecycleEventMatches(setting: SuiteRecord, input: { eventType: SuiteEventType; type: SuiteType; itemId: string }): boolean {
  if (setting.deleted === true || setting.enabled === false) return false
  const status = cleanString(setting.status)
  if (status === 'archived' || status === 'revoked' || status === 'inactive') return false

  const eventType = cleanString(setting.eventType)
  if (eventType) {
    const action = input.eventType.replace('suite_', '')
    const acceptedEvents = new Set([
      '*',
      input.eventType,
      `project.${input.eventType}`,
      `${input.type}_${action}`,
      `${input.type}.${action}`,
    ])
    if (!acceptedEvents.has(eventType)) return false
  }

  const itemType = cleanString(setting.itemType ?? setting.targetType ?? setting.resourceType)
  if (itemType && itemType !== '*' && itemType !== input.type) return false

  const itemId = cleanString(setting.itemId ?? setting.targetId ?? setting.resourceId)
  if (itemId && itemId !== '*' && itemId !== input.itemId) return false

  const channel = cleanString(setting.channel)
  return !channel || channel === 'in_app' || channel === 'app' || channel === 'both'
}

function memberIsActive(member: Record<string, unknown>): boolean {
  if (member.deleted === true) return false
  const status = cleanString(member.status)
  return !status || (status !== 'revoked' && status !== 'archived' && status !== 'inactive' && status !== 'removed')
}

function projectRoleRank(role: unknown): number | undefined {
  const normalized = cleanString(role) as ProjectMemberRole
  return PROJECT_ROLE_RANK[normalized]
}

function roleMatchesAny(role: unknown, recipientRoleIds: string[]): boolean {
  if (recipientRoleIds.length === 0) return false
  const memberRank = projectRoleRank(role)
  if (!memberRank) return false
  const recipientRanks = recipientRoleIds
    .map((recipientRole) => projectRoleRank(recipientRole))
    .filter((rank): rank is number => typeof rank === 'number')
  if (recipientRanks.length === 0) return false
  return memberRank >= Math.min(...recipientRanks)
}

async function listProjectMembersForNotifications(projectId: string): Promise<Array<SuiteRecord & { uid?: string }>> {
  const snap = await adminDb.collection('projectMembers').where('projectId', '==', projectId).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({
    id: doc.id,
    ...doc.data(),
  })).filter((member) => memberIsActive(member))
}

async function writeSuiteNotifications(input: {
  projectId: string
  project: Record<string, unknown>
  eventType: SuiteEventType
  type: SuiteType
  itemId: string
  title?: string
  actorUid: string
}) {
  if (input.type === 'audit') return

  const settings = (await listSubcollection(input.projectId, 'notificationSettings'))
    .filter((setting) => lifecycleEventMatches(setting, input))
  if (settings.length === 0) return

  const members = await listProjectMembersForNotifications(input.projectId)
  const orgId = projectOwnerOrgId(input.project)
  if (!orgId) return

  const itemLabel = input.type.charAt(0).toUpperCase() + input.type.slice(1)
  const actionLabel = input.eventType.replace('suite_', '')
  const body = input.title || `${itemLabel} ${actionLabel}`

  for (const setting of settings) {
    const recipientUserIds = new Set(cleanStringArray(setting.recipientUserIds))
    const recipientRoleIds = cleanStringArray(setting.recipientRoleIds ?? setting.recipientRoles)
    const recipientOrgIds = cleanStringArray(setting.recipientOrgIds)

    for (const member of members) {
      const uid = cleanString(member.uid ?? member.userId)
      if (!uid || uid === input.actorUid) continue
      const matchesUser = recipientUserIds.has(uid)
      const matchesRole = roleMatchesAny(member.role, recipientRoleIds)
      const matchesOrg = recipientOrgIds.includes(cleanString(member.orgId))
      if (!matchesUser && !matchesRole && !matchesOrg) continue

      await adminDb.collection('notifications').add({
        orgId,
        userId: uid,
        agentId: null,
        type: `project.${input.eventType}`,
        title: cleanString(setting.title) || `${itemLabel} ${actionLabel}`,
        body,
        link: `/portal/projects/${input.projectId}?suite=${input.type}&item=${input.itemId}`,
        data: {
          projectId: input.projectId,
          itemType: input.type,
          itemId: input.itemId,
          eventType: input.eventType,
          notificationSettingId: setting.id,
          channel: cleanString(setting.channel) || 'in_app',
        },
        status: 'unread',
        priority: 'normal',
        snoozedUntil: null,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
  }
}

function filterItemsForGrant<T extends SuiteRecord>(
  items: T[],
  projectAccess: { crossOrgGrant?: { items: string[] } } | undefined,
): T[] {
  const grantedItems = projectAccess?.crossOrgGrant?.items ?? []
  return grantedItems.length === 0 ? items : items.filter((item) => grantedItems.includes(item.id))
}

function grantAllowsSuiteAction(
  access: { crossOrgGrant?: { actions: string[]; items: string[] } } | undefined,
  action: 'project.read' | 'project.write',
  itemId?: string,
): boolean {
  const grant = access?.crossOrgGrant
  if (!grant) return true
  if (!grant.actions.includes(action)) return false
  return !itemId || grant.items.length === 0 || grant.items.includes(itemId)
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.read' })
  if (!access.ok) return apiError(access.error, access.status)
  if (!grantAllowsSuiteAction(access.projectAccess ?? undefined, 'project.read')) {
    return apiError('Project read is not granted for this cross-organisation share', 403)
  }

  const [
    tasksRaw,
    milestonesRaw,
    approvalsRaw,
    risksRaw,
    decisionsRaw,
    baselinesRaw,
    playbooksRaw,
    automationsRaw,
    permissionsRaw,
    auditRaw,
    notificationSettingsRaw,
    capacitiesRaw,
    revenueRaw,
  ] = await Promise.all([
    listSubcollection(projectId, 'tasks'),
    listSubcollection(projectId, 'milestones'),
    listSubcollection(projectId, 'approvals'),
    listSubcollection(projectId, 'risks'),
    listSubcollection(projectId, 'decisions'),
    listSubcollection(projectId, 'baselines'),
    listSubcollection(projectId, 'playbooks'),
    listSubcollection(projectId, 'automations'),
    listSubcollection(projectId, 'permissions'),
    listSubcollection(projectId, 'audit'),
    listSubcollection(projectId, 'notificationSettings'),
    listSubcollection(projectId, 'capacities'),
    listSubcollection(projectId, 'revenue'),
  ])
  const filterItems = <T extends SuiteRecord>(items: T[]) => filterItemsForGrant(filterProjectItemsForAccess(items, {
    projectAccess: access.projectAccess,
    user,
  }) as T[], access.projectAccess ?? undefined)
  const tasks = filterItems(applyPermissionPolicies(tasksRaw, permissionsRaw, 'task'))
  const milestones = filterItems(applyPermissionPolicies(milestonesRaw, permissionsRaw, 'milestone'))
  const approvals = filterItems(applyPermissionPolicies(approvalsRaw, permissionsRaw, 'approval'))
  const risks = filterItems(applyPermissionPolicies(risksRaw, permissionsRaw, 'risk'))
  const decisions = filterItems(applyPermissionPolicies(decisionsRaw, permissionsRaw, 'decision'))
  const baselines = filterItems(applyPermissionPolicies(baselinesRaw, permissionsRaw, 'baseline'))
  const playbooks = filterItems(applyPermissionPolicies(playbooksRaw, permissionsRaw, 'playbook'))
  const automations = filterItems(applyPermissionPolicies(automationsRaw, permissionsRaw, 'automation'))
  const permissions = filterItems(permissionsRaw)
  const audit = filterItems(auditRaw)
  const notificationSettings = filterItems(applyPermissionPolicies(notificationSettingsRaw, permissionsRaw, 'notification'))
  const capacities = filterItems(applyPermissionPolicies(capacitiesRaw, permissionsRaw, 'capacity'))
  const revenue = filterItems(applyPermissionPolicies(revenueRaw, permissionsRaw, 'revenue'))

  return apiSuccess({
    planningDiscovery: (access.doc.data() ?? {}).planningDiscovery ?? null,
    health: buildProjectHealth({ tasks, milestones, approvals }),
    timeline: buildProjectTimeline({ tasks, milestones, baselines }),
    workload: buildProjectWorkload({ tasks, capacities }),
    reports: buildProjectReports({ tasks, milestones, approvals, risks, revenue }),
    tasks,
    milestones,
    approvals,
    risks,
    decisions,
    baselines,
    playbooks,
    automations,
    permissions,
    audit,
    notificationSettings,
    capacities,
    revenue,
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const isPlaybookRun = cleanString(body.type) === 'playbook' && cleanString(body.action) === 'run'
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  const isAgentActor = user.role === 'ai' || user.authKind === 'user_delegation'
  if (isPlaybookRun && isAgentActor && !explicitOrgId) {
    return apiError('X-Org-Id is required for agent playbook execution', 400)
  }
  if (isPlaybookRun && isAgentActor && user.orgId && explicitOrgId !== user.orgId) {
    return apiError('Agent organisation scope does not match X-Org-Id', 403)
  }
  const type = cleanString(body.type) as SuiteType
  const action = cleanString(body.action)
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) {
    return apiError('type must be one of: milestone, approval, risk, decision, baseline, playbook, automation, permission, audit, notification, capacity, revenue', 400)
  }
  const playbookId = isPlaybookRun ? cleanString(body.id) : undefined
  if (isPlaybookRun && !playbookId) return apiError('id is required to run a playbook', 400)
  const access = await getProjectForUser(
    projectId,
    user,
    isPlaybookRun ? explicitOrgId || undefined : undefined,
    { action: 'project.write', item: playbookId },
  )
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required', 403)
  }
  if (!grantAllowsSuiteAction(access.projectAccess ?? undefined, 'project.write', playbookId)) {
    return apiError('Project write is not granted for this cross-organisation share', 403)
  }
  if (!isPlaybookRun && (access.projectAccess?.crossOrgGrant?.items.length ?? 0) > 0) {
    return apiError('Item-scoped cross-organisation grants cannot create unscoped project suite records', 403)
  }

  const planningSensitive = suiteMutationRequiresPlanning(type)

  const requiredPermission = permissionForSuiteType(type)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', requiredPermission)) {
    return apiError('Project manager access is required for this project suite record', 403)
  }

  if (type === 'playbook' && action === 'run') {
    const id = cleanString(body.id)
    if (!id) return apiError('id is required to run a playbook', 400)
    const ref = adminDb.collection('projects').doc(projectId).collection(collectionName).doc(id)
    const doc = await ref.get()
    if (!doc.exists) return apiError('Playbook not found', 404)
    const playbook = { id, ...(doc.data() ?? {}) } as SuiteRecord
    if (playbook.deleted === true || playbook.status === 'archived') return apiError('Archived playbooks cannot be run', 400)
    const run = await runProjectPlaybookTemplate({
      projectId,
      playbookId: id,
      playbook,
      project: (access.doc.data() ?? {}) as Record<string, unknown>,
      actorUid: user.uid,
      runKey: cleanString(body.runKey) || cleanString(req.headers.get('idempotency-key')) || undefined,
    })
    if (!run.ok) return apiError(run.error, run.status)
    return apiSuccess(run.data, run.data.deduplicated ? 200 : 201)
  }

  const record = suiteMutableFields(body, type, user.uid, 'create')
  if (!record.ok) return apiError(record.error, 400)
  const toWrite = record.value
  const projectRef = adminDb.collection('projects').doc(projectId)
  const ref = projectRef.collection(collectionName).doc()
  const mutation = await adminDb.runTransaction(async (tx) => {
    if (planningSensitive) {
      const liveProject = await tx.get(projectRef)
      if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
      const project = (liveProject.data() ?? {}) as Record<string, unknown>
      const planning = applyPlanningMutation(tx, projectRef, projectId, project, user.uid, `project_suite.${type}.created`)
      if (!planning.allowed) return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
    }
    tx.set(ref, toWrite)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)
  const project = (access.doc.data() ?? {}) as Record<string, unknown>
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_created',
    type,
    itemId: ref.id,
    title: cleanString(toWrite.title),
    actorUid: user.uid,
  })
  await writeSuiteNotifications({
    projectId,
    project,
    eventType: 'suite_created',
    type,
    itemId: ref.id,
    title: cleanString(toWrite.title),
    actorUid: user.uid,
  }).catch((err) => console.error('[project-suite-notification-error]', err))
  return apiSuccess({ id: ref.id, ...toWrite }, 201)
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const id = cleanString(body.id)
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) return apiError('Invalid suite record type', 400)
  if (!id) return apiError('id is required', 400)
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: id })
  if (!access.ok) return apiError(access.error, access.status)
  const planningSensitive = suiteMutationRequiresPlanning(type)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', permissionForSuiteType(type))) {
    return apiError('Project manager access is required for this project suite record', 403)
  }
  if (!grantAllowsSuiteAction(access.projectAccess ?? undefined, 'project.write', id)) {
    return apiError('Project write is not granted for this cross-organisation share', 403)
  }

  const updates = suiteMutableFields(body, type, user.uid, 'update')
  if (!updates.ok) return apiError(updates.error, 400)

  const ref = adminDb.collection('projects').doc(projectId).collection(collectionName).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Suite record not found', 404)
  const projectRef = adminDb.collection('projects').doc(projectId)
  const mutation = await adminDb.runTransaction(async (tx) => {
    let liveProject: FirebaseFirestore.DocumentSnapshot | null = null
    if (planningSensitive) {
      liveProject = await tx.get(projectRef)
      if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    }
    const liveRecord = await tx.get(ref)
    if (!liveRecord.exists) return { ok: false as const, status: 404, error: 'Suite record not found' }
    if (liveProject) {
      const project = (liveProject.data() ?? {}) as Record<string, unknown>
      const planning = applyPlanningMutation(tx, projectRef, projectId, project, user.uid, `project_suite.${type}.updated`)
      if (!planning.allowed) return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
    }
    tx.update(ref, updates.value)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)
  const project = (access.doc.data() ?? {}) as Record<string, unknown>
  const title = cleanString(updates.value.title) || cleanString(doc.data()?.title)
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_updated',
    type,
    itemId: id,
    title,
    actorUid: user.uid,
  })
  await writeSuiteNotifications({
    projectId,
    project,
    eventType: 'suite_updated',
    type,
    itemId: id,
    title,
    actorUid: user.uid,
  }).catch((err) => console.error('[project-suite-notification-error]', err))
  return apiSuccess({ id, ...updates.value })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const id = cleanString(body.id)
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) return apiError('Invalid suite record type', 400)
  if (!id) return apiError('id is required', 400)
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: id })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', permissionForSuiteType(type))) {
    return apiError('Project manager access is required for this project suite record', 403)
  }
  if (!grantAllowsSuiteAction(access.projectAccess ?? undefined, 'project.write', id)) {
    return apiError('Project write is not granted for this cross-organisation share', 403)
  }
  const planningSensitive = suiteMutationRequiresPlanning(type)

  const ref = adminDb.collection('projects').doc(projectId).collection(collectionName).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Suite record not found', 404)
  const project = (access.doc.data() ?? {}) as Record<string, unknown>
  const title = cleanString(doc.data()?.title)
  const archiveValue = {
    deleted: true,
    status: 'archived',
    archivedBy: user.uid,
    archivedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const projectRef = adminDb.collection('projects').doc(projectId)
  const mutation = await adminDb.runTransaction(async (tx) => {
    let liveProject: FirebaseFirestore.DocumentSnapshot | null = null
    if (planningSensitive) {
      liveProject = await tx.get(projectRef)
      if (!liveProject.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    }
    const liveRecord = await tx.get(ref)
    if (!liveRecord.exists) return { ok: false as const, status: 404, error: 'Suite record not found' }
    if (liveProject) {
      const project = (liveProject.data() ?? {}) as Record<string, unknown>
      const planning = applyPlanningMutation(tx, projectRef, projectId, project, user.uid, `project_suite.${type}.archived`)
      if (!planning.allowed) return { ok: false as const, status: 409, error: planning.blocker.message, details: planning.blocker }
    }
    tx.update(ref, archiveValue)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, mutation.details)
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_archived',
    type,
    itemId: id,
    title,
    actorUid: user.uid,
  })
  await writeSuiteNotifications({
    projectId,
    project,
    eventType: 'suite_archived',
    type,
    itemId: id,
    title,
    actorUid: user.uid,
  }).catch((err) => console.error('[project-suite-notification-error]', err))
  return apiSuccess({ id, deleted: true })
})
