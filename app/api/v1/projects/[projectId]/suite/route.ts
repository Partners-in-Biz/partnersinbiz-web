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

async function listSubcollection(projectId: string, collectionName: string) {
  const snap = await adminDb.collection('projects').doc(projectId).collection(collectionName).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }))
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

  const requiredPermission = ['baseline', 'playbook', 'automation', 'permission', 'notification', 'capacity', 'revenue'].includes(type)
    ? 'manage_project'
    : 'write'
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', requiredPermission)) {
    return apiError('Project manager access is required for this project suite record', 403)
  }

  const title = cleanString(body.title)
  if (!title) return apiError('title is required', 400)

  const record: Record<string, unknown> = {
    type,
    title,
    description: cleanString(body.description),
    status: cleanString(body.status) || (type === 'risk' ? 'open' : type === 'decision' ? 'proposed' : 'active'),
    ownerUid: cleanString(body.ownerUid) || user.uid,
    startDate: cleanString(body.startDate) || null,
    dueDate: cleanString(body.dueDate) || null,
    endDate: cleanString(body.endDate) || null,
    baselineStartDate: cleanString(body.baselineStartDate) || null,
    baselineDueDate: cleanString(body.baselineDueDate) || null,
    severity: cleanString(body.severity) || undefined,
    trigger: cleanString(body.trigger) || undefined,
    cadence: cleanString(body.cadence) || undefined,
    templateId: cleanString(body.templateId) || undefined,
    channel: cleanString(body.channel) || undefined,
    visibility: cleanString(body.visibility) || (body.internalOnly === true ? 'internal' : 'project'),
    allowedUserIds: cleanStringArray(body.allowedUserIds),
    allowedOrgIds: cleanStringArray(body.allowedOrgIds),
    allowedRoleIds: cleanStringArray(body.allowedRoleIds),
    dependsOn: cleanStringArray(body.dependsOn ?? body.dependencyIds),
    notificationChannels: cleanStringArray(body.notificationChannels),
    amount: cleanNumber(body.amount),
    currency: cleanString(body.currency) || undefined,
    capacityMinutes: cleanNumber(body.capacityMinutes ?? body.weeklyMinutes),
    reviewerIds: Array.isArray(body.reviewerIds)
      ? body.reviewerIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    linkedTaskIds: Array.isArray(body.linkedTaskIds)
      ? body.linkedTaskIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    internalOnly: body.internalOnly === true,
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const toWrite = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
  const ref = await adminDb.collection('projects').doc(projectId).collection(collectionName).add(toWrite)
  return apiSuccess({ id: ref.id, ...toWrite }, 201)
})
