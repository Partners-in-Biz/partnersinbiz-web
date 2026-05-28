import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getProjectForUser } from '@/lib/projects/access'
import {
  buildProjectHealth,
  buildProjectReports,
  buildProjectTimeline,
  buildProjectWorkload,
  filterProjectItemsForAccess,
} from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

const PROJECT_ORG_FIELDS = ['ownerOrgId', 'sourceOrgId', 'orgId', 'clientOrgId', 'recipientOrgId', 'targetOrgId'] as const
const SUITE_COLLECTIONS = ['tasks', 'milestones', 'approvals', 'risks', 'capacities', 'revenue'] as const

type ProjectRow = Record<string, unknown> & { id: string }
type SuiteRow = Record<string, unknown> & { id: string; deleted?: unknown }
type FirestoreDoc = { id: string; data: () => Record<string, unknown> }
type ApiUserLike = { orgId?: string | null }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function docRows(snap: { docs?: FirestoreDoc[] } | null | undefined): ProjectRow[] {
  return (snap?.docs ?? []).map((doc) => ({ id: doc.id, ...doc.data() }))
}

function suiteRows(snap: { docs?: FirestoreDoc[] } | null | undefined): SuiteRow[] {
  return (snap?.docs ?? [])
    .map((doc) => ({ id: doc.id, ...doc.data() }) as SuiteRow)
    .filter((item) => item.deleted !== true)
}

async function loadProjectsForOrg(orgId: string, limit: number): Promise<ProjectRow[]> {
  const snaps = await Promise.all(
    PROJECT_ORG_FIELDS.map((field) => adminDb.collection('projects').where(field, '==', orgId).get()),
  )
  const byId = new Map<string, ProjectRow>()
  for (const snap of snaps) {
    for (const project of docRows(snap)) {
      if (project.deleted === true || project.archived === true) continue
      byId.set(project.id, project)
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .slice(0, limit)
}

async function loadProjectSuite(projectId: string) {
  const ref = adminDb.collection('projects').doc(projectId)
  const snaps = await Promise.all(SUITE_COLLECTIONS.map((name) => ref.collection(name).get()))
  return {
    tasks: suiteRows(snaps[0]),
    milestones: suiteRows(snaps[1]),
    approvals: suiteRows(snaps[2]),
    risks: suiteRows(snaps[3]),
    capacities: suiteRows(snaps[4]),
    revenue: suiteRows(snaps[5]),
  }
}

function clientKey(project: ProjectRow): string {
  return cleanString(project.clientOrgId) ||
    cleanString(project.recipientOrgId) ||
    cleanString(project.targetOrgId) ||
    cleanString(project.orgId) ||
    'unassigned'
}

function clientName(project: ProjectRow, key: string): string {
  return cleanString(project.clientName) ||
    cleanString(project.recipientCompanyName) ||
    cleanString(project.companyName) ||
    cleanString(project.orgName) ||
    key
}

function compactProjectName(project: ProjectRow): string {
  return cleanString(project.name) || cleanString(project.title) || project.id
}

async function resolveRequestedOrgId(searchParams: URLSearchParams, user: ApiUserLike): Promise<{ orgId: string; error?: string; status?: number }> {
  const explicitOrgId = cleanString(searchParams.get('orgId'))
  if (explicitOrgId) return { orgId: explicitOrgId }

  const orgSlug = cleanString(searchParams.get('orgSlug'))
  if (orgSlug) {
    const orgSnapshot = await adminDb
      .collection('organizations')
      .where('slug', '==', orgSlug)
      .limit(1)
      .get()

    if (orgSnapshot.empty) {
      return { orgId: '', error: 'Organization not found', status: 404 }
    }

    return { orgId: orgSnapshot.docs[0].id }
  }

  return { orgId: cleanString(user.orgId) }
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const resolved = await resolveRequestedOrgId(searchParams, user)
  if (resolved.error) return apiError(resolved.error, resolved.status ?? 400)
  const orgId = resolved.orgId
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const limitRaw = Number(searchParams.get('limit') ?? 30)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 50)
  const projects = await loadProjectsForOrg(orgId, limit)

  const portfolio = []
  const clients = new Map<string, {
    clientOrgId: string
    clientName: string
    projectCount: number
    trackedRevenue: number
    openTasks: number
    blockedTasks: number
    highRisks: number
  }>()
  const people = new Map<string, {
    uid: string
    name: string
    assignedTasks: number
    estimateMinutes: number
    capacityMinutes: number
  }>()
  const currencyTotals = new Map<string, number>()
  let totalTasks = 0
  let openTasks = 0
  let blockedTasks = 0
  let overdueTasks = 0
  let waitingApprovals = 0
  let milestoneDrift = 0
  let highRisks = 0
  let overCapacityPeople = 0

  for (const project of projects) {
    const access = await getProjectForUser(project.id, user)
    if (!access.ok) continue
    const raw = await loadProjectSuite(project.id)
    const filterItems = <T extends object>(items: T[]) => filterProjectItemsForAccess(items, {
      projectAccess: access.projectAccess,
      user,
    })
    const tasks = filterItems(raw.tasks)
    const milestones = filterItems(raw.milestones)
    const approvals = filterItems(raw.approvals)
    const risks = filterItems(raw.risks)
    const capacities = filterItems(raw.capacities)
    const revenue = filterItems(raw.revenue)

    const health = buildProjectHealth({ tasks, milestones, approvals })
    const timeline = buildProjectTimeline({ tasks, milestones })
    const workload = buildProjectWorkload({ tasks, capacities })
    const reports = buildProjectReports({ tasks, milestones, approvals, risks, revenue })
    const revenueAmount = reports.revenue.trackedAmount
    const currency = reports.revenue.currency || 'ZAR'
    currencyTotals.set(currency, (currencyTotals.get(currency) ?? 0) + revenueAmount)

    totalTasks += reports.tasks.total
    openTasks += reports.tasks.open
    blockedTasks += reports.tasks.blocked
    overdueTasks += reports.tasks.overdue
    waitingApprovals += reports.approvals.waiting
    milestoneDrift += reports.milestones.drift
    highRisks += reports.risks.high
    overCapacityPeople += workload.overCapacityCount

    for (const assignee of workload.assignees) {
      const uid = cleanString(assignee.uid)
      if (!uid) continue
      const row = people.get(uid) ?? {
        uid,
        name: cleanString(assignee.name) || uid,
        assignedTasks: 0,
        estimateMinutes: 0,
        capacityMinutes: 0,
      }
      row.assignedTasks += numericValue(assignee.assignedTasks)
      row.estimateMinutes += numericValue(assignee.estimateMinutes)
      row.capacityMinutes += numericValue(assignee.capacityMinutes)
      if (!row.name || row.name === uid) row.name = cleanString(assignee.name) || uid
      people.set(uid, row)
    }

    const key = clientKey(project)
    const client = clients.get(key) ?? {
      clientOrgId: key,
      clientName: clientName(project, key),
      projectCount: 0,
      trackedRevenue: 0,
      openTasks: 0,
      blockedTasks: 0,
      highRisks: 0,
    }
    client.projectCount += 1
    client.trackedRevenue += revenueAmount
    client.openTasks += reports.tasks.open
    client.blockedTasks += reports.tasks.blocked
    client.highRisks += reports.risks.high
    clients.set(key, client)

    portfolio.push({
      id: project.id,
      name: compactProjectName(project),
      status: cleanString(project.status) || 'active',
      clientOrgId: key,
      clientName: client.clientName,
      health,
      timeline: {
        driftCount: timeline.driftCount,
        dependencyCount: timeline.dependencyCount,
      },
      workload,
      reports,
    })
  }

  const currencyEntries = Array.from(currencyTotals.entries())
  const mixedCurrency = currencyEntries.length > 1
  const trackedRevenue = currencyEntries.reduce((total, [, amount]) => total + amount, 0)
  const peopleRows = Array.from(people.values())
    .map((row) => ({
      ...row,
      utilizationPercent: row.capacityMinutes > 0 ? Math.round((row.estimateMinutes / row.capacityMinutes) * 100) : 0,
      overCapacity: row.capacityMinutes > 0 && row.estimateMinutes > row.capacityMinutes,
    }))
    .sort((a, b) => b.estimateMinutes - a.estimateMinutes)

  return apiSuccess({
    orgId,
    summary: {
      totalProjects: portfolio.length,
      totalTasks,
      openTasks,
      blockedTasks,
      overdueTasks,
      waitingApprovals,
      milestoneDrift,
      highRisks,
      overCapacityPeople,
      trackedRevenue,
      currency: mixedCurrency ? null : currencyEntries[0]?.[0] ?? 'ZAR',
      mixedCurrency,
      revenueByCurrency: Object.fromEntries(currencyEntries),
    },
    clients: Array.from(clients.values()).sort((a, b) => b.trackedRevenue - a.trackedRevenue),
    people: peopleRows,
    projects: portfolio,
  })
})
