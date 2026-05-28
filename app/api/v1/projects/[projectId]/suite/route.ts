import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import {
  buildProjectHealth,
  buildProjectReports,
  buildProjectTimeline,
  buildProjectWorkload,
  canProjectRole,
  filterProjectItemsForAccess,
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

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
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
  eventType: 'suite_created' | 'suite_updated' | 'suite_archived'
  type: SuiteType
  itemId: string
  title?: string
  actorUid: string
}) {
  if (input.type === 'audit') return
  await adminDb.collection('projects').doc(input.projectId).collection('audit').add({
    type: 'audit',
    eventType: input.eventType,
    itemType: input.type,
    itemId: input.itemId,
    title: input.title || `${input.type} ${input.eventType.replace('suite_', '')}`,
    actorUid: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

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
  const filterItems = <T extends object>(items: T[]) => filterProjectItemsForAccess(items, {
    projectAccess: access.projectAccess,
    user,
  })
  const tasks = filterItems(tasksRaw)
  const milestones = filterItems(milestonesRaw)
  const approvals = filterItems(approvalsRaw)
  const risks = filterItems(risksRaw)
  const decisions = filterItems(decisionsRaw)
  const baselines = filterItems(baselinesRaw)
  const playbooks = filterItems(playbooksRaw)
  const automations = filterItems(automationsRaw)
  const permissions = filterItems(permissionsRaw)
  const audit = filterItems(auditRaw)
  const notificationSettings = filterItems(notificationSettingsRaw)
  const capacities = filterItems(capacitiesRaw)
  const revenue = filterItems(revenueRaw)

  return apiSuccess({
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
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required', 403)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) {
    return apiError('type must be one of: milestone, approval, risk, decision, baseline, playbook, automation, permission, audit, notification, capacity, revenue', 400)
  }

  const requiredPermission = permissionForSuiteType(type)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', requiredPermission)) {
    return apiError('Project manager access is required for this project suite record', 403)
  }

  const record = suiteMutableFields(body, type, user.uid, 'create')
  if (!record.ok) return apiError(record.error, 400)
  const toWrite = record.value
  const ref = await adminDb.collection('projects').doc(projectId).collection(collectionName).add(toWrite)
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_created',
    type,
    itemId: ref.id,
    title: cleanString(toWrite.title),
    actorUid: user.uid,
  })
  return apiSuccess({ id: ref.id, ...toWrite }, 201)
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const id = cleanString(body.id)
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) return apiError('Invalid suite record type', 400)
  if (!id) return apiError('id is required', 400)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', permissionForSuiteType(type))) {
    return apiError('Project manager access is required for this project suite record', 403)
  }

  const updates = suiteMutableFields(body, type, user.uid, 'update')
  if (!updates.ok) return apiError(updates.error, 400)

  const ref = adminDb.collection('projects').doc(projectId).collection(collectionName).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Suite record not found', 404)
  await ref.update(updates.value)
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_updated',
    type,
    itemId: id,
    title: cleanString(updates.value.title) || cleanString(doc.data()?.title),
    actorUid: user.uid,
  })
  return apiSuccess({ id, ...updates.value })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const id = cleanString(body.id)
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) return apiError('Invalid suite record type', 400)
  if (!id) return apiError('id is required', 400)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', permissionForSuiteType(type))) {
    return apiError('Project manager access is required for this project suite record', 403)
  }

  const ref = adminDb.collection('projects').doc(projectId).collection(collectionName).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Suite record not found', 404)
  await ref.update({
    deleted: true,
    status: 'archived',
    archivedBy: user.uid,
    archivedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await writeSuiteAudit({
    projectId,
    eventType: 'suite_archived',
    type,
    itemId: id,
    title: cleanString(doc.data()?.title),
    actorUid: user.uid,
  })
  return apiSuccess({ id, deleted: true })
})
