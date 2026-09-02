/**
 * GET   /api/v1/projects/[projectId]  — get a single project
 * PATCH /api/v1/projects/[projectId]  — update a project
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import { publicProjectView } from '@/lib/projects/public'
import { isSurfaceMode } from '@/lib/design/surface-modes'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { normalizeProjectLinks, pickProjectLinkFields, type ProjectLinkSet } from '@/lib/client-documents/linkedValidation'
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'
import {
  applyPlanningDiscoveryAction,
  isPlanningReady,
  planningMutationBlocker,
  type PlanningActionResult,
  type PlanningDiscoveryState,
} from '@/lib/projects/planningDiscovery'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

const VALID_STATUSES = [
  'discovery',
  'design',
  'development',
  'review',
  'live',
  'maintenance',
] as const

type ProjectStatus = (typeof VALID_STATUSES)[number]

const PROJECT_STATUS_RANK = new Map<ProjectStatus, number>(VALID_STATUSES.map((status, index) => [status, index]))

type LinkSafetyUser = Parameters<typeof canAccessOrg>[0]

function normalizeProjectTargetDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return undefined

  return trimmed
}

function materialPlanningValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value === undefined) return ''
  try { return JSON.stringify(value) } catch { return String(value) }
}

function materialPlanningContextReason(project: Record<string, unknown>, body: Record<string, unknown>): string | null {
  if (body.description !== undefined && materialPlanningValue(body.description) !== materialPlanningValue(project.description)) {
    return 'Project description materially changed'
  }
  if (body.brief !== undefined && materialPlanningValue(body.brief) !== materialPlanningValue(project.brief)) {
    return 'Project brief materially changed'
  }
  return null
}

function promotesProjectLifecycle(current: unknown, next: unknown): boolean {
  if (typeof next !== 'string' || !PROJECT_STATUS_RANK.has(next as ProjectStatus) || next === 'discovery') return false
  const currentRank = typeof current === 'string' ? PROJECT_STATUS_RANK.get(current as ProjectStatus) : undefined
  const nextRank = PROJECT_STATUS_RANK.get(next as ProjectStatus) ?? 0
  return nextRank > (currentRank ?? 0)
}

async function loadOwnedCrmRecord(collection: 'companies' | 'contacts', id: string, orgId: string) {
  const snap = await adminDb.collection(collection).doc(id).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  if (data.deleted === true) return null
  return data.orgId === orgId ? data : null
}

async function assertProjectPatchLinkTenantSafety(
  links: ProjectLinkSet,
  sourceOrgId: string,
  user: LinkSafetyUser,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const linkedOrgIds = Array.from(new Set([...(links.recipientOrgIds ?? []), ...(links.clientOrgIds ?? [])]))
  for (const orgId of linkedOrgIds) {
    if (!canAccessOrg(user, orgId)) return { ok: false, error: `Forbidden linked recipient org: ${orgId}`, status: 403 }
  }

  const companyIds = Array.from(new Set([...(links.companyIds ?? []), ...(links.sourceCompanyIds ?? [])]))
  for (const companyId of companyIds) {
    const company = await loadOwnedCrmRecord('companies', companyId, sourceOrgId)
    if (!company) return { ok: false, error: `Project company link is outside the source org: ${companyId}`, status: 400 }
  }

  const contactIds = Array.from(new Set([...(links.contactIds ?? []), ...(links.sourceContactIds ?? [])]))
  for (const contactId of contactIds) {
    const contact = await loadOwnedCrmRecord('contacts', contactId, sourceOrgId)
    if (!contact) return { ok: false, error: `Project contact link is outside the source org: ${contactId}`, status: 400 }
  }

  return { ok: true }
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)

  if (!access.ok) return apiError(access.error, access.status)
  const doc = access.doc
  return apiSuccess(publicProjectView({ id: doc.id, ...doc.data() }))
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role, 'write')) {
    return apiError('Project contributor access required', 403)
  }
  const requestedLinks = pickProjectLinkFields(body)
  const requiresProjectManagement = body.name !== undefined
    || body.status !== undefined
    || body.surfaceMode !== undefined
    || body.archived !== undefined
    || body.targetDate !== undefined
    || body.dueDate !== undefined
    || Object.keys(requestedLinks).length > 0
  if (requiresProjectManagement && !canProjectRole(access.projectAccess?.role, 'manage_project')) {
    return apiError('Project manager access required', 403)
  }
  if (Object.keys(requestedLinks).length > 0 && access.projectAccess?.canViewInternal !== true) {
    return apiError('Project owner-organisation access required to change sharing links', 403)
  }

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) {
    if (!body.name.trim()) return apiError('name cannot be empty', 400)
    updates.name = body.name.trim()
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as ProjectStatus)) {
      return apiError('Invalid status', 400)
    }
    updates.status = body.status
  }

  if (body.surfaceMode !== undefined) {
    if (body.surfaceMode !== null && !isSurfaceMode(body.surfaceMode)) {
      return apiError('surfaceMode must be one of persuade, operate, read, experience', 400)
    }
    updates.surfaceMode = body.surfaceMode
  }

  const projectData = (access.doc.data() ?? {}) as Record<string, unknown>
  const currentPlanning = projectData.planningDiscovery as PlanningDiscoveryState | undefined
  const materialPlanningReason = materialPlanningContextReason(projectData, body as Record<string, unknown>)
  if (promotesProjectLifecycle(projectData.status, body.status)) {
    if (materialPlanningReason) {
      return apiError('Confirm the revised planning context before promoting the project lifecycle', 409, {
        code: 'planning_discovery_required',
        revision: currentPlanning?.revision ?? 0,
      })
    }
    if (!isPlanningReady(currentPlanning)) {
      return apiError('Planning discovery must be ready before promoting the project beyond discovery', 409, {
        code: 'planning_discovery_required',
        revision: currentPlanning?.revision ?? 0,
      })
    }
  }
  const projectPlanningSensitive = body.name !== undefined
    || body.description !== undefined
    || body.brief !== undefined
    || body.targetDate !== undefined
    || body.dueDate !== undefined

  if (body.archived !== undefined) {
    updates.archived = body.archived === true
    updates.archivedAt = body.archived === true ? FieldValue.serverTimestamp() : null
    updates.archivedBy = body.archived === true ? user.uid : null
  }

  if (body.description !== undefined) {
    updates.description = body.description
  }

  if (body.brief !== undefined) {
    updates.brief = body.brief
  }

  if (body.codeRoots !== undefined) {
    const { normalizeProjectCodeRoots } = await import('@/lib/projects/code-workspace')
    if (body.codeRoots !== null && !Array.isArray(body.codeRoots)) {
      return apiError('codeRoots must be an array', 400)
    }
    updates.codeRoots = normalizeProjectCodeRoots(body.codeRoots)
  }

  if (body.sharedFolder !== undefined) {
    updates.sharedFolder = body.sharedFolder === true
  }

  if (body.clientVisibility !== undefined) {
    if (access.projectAccess?.canViewInternal !== true) {
      return apiError('Project owner-organisation access required to change client visibility', 403)
    }
    Object.assign(updates, clientVisibilityFieldsForWrite(body.clientVisibility))
  }

  if (body.projectFolderMode !== undefined) {
    if (body.projectFolderMode !== 'standard' && body.projectFolderMode !== 'registered') {
      return apiError('projectFolderMode must be standard or registered', 400)
    }
    updates.projectFolderMode = body.projectFolderMode
  }

  if (body.targetDate !== undefined || body.dueDate !== undefined) {
    const nextTargetDate = normalizeProjectTargetDate(body.targetDate !== undefined ? body.targetDate : body.dueDate)
    if (nextTargetDate === undefined) return apiError('Invalid targetDate', 400)
    updates.targetDate = nextTargetDate
  }

  const orgId = projectData.orgId as string | undefined
  const sourceOrgId = (projectData.sourceOrgId as string | undefined) || orgId
  if (Object.keys(requestedLinks).length > 0) {
    const existing = projectData
    const requestedProjectLinks = { ...requestedLinks }
    if (requestedProjectLinks.sourceCompanyId !== undefined && requestedProjectLinks.companyId === undefined) {
      requestedProjectLinks.companyId = requestedProjectLinks.sourceCompanyId
    }
    if (requestedProjectLinks.sourceContactId !== undefined && requestedProjectLinks.contactId === undefined) {
      requestedProjectLinks.contactId = requestedProjectLinks.sourceContactId
    }
    const normalizedLinks = normalizeProjectLinks({ ...pickProjectLinkFields(existing), ...requestedProjectLinks })
    if (normalizedLinks.ok === false) return apiError(normalizedLinks.error, 400)
    if (sourceOrgId) {
      const linkSafety = await assertProjectPatchLinkTenantSafety(normalizedLinks.value, sourceOrgId, user)
      if (linkSafety.ok === false) return apiError(linkSafety.error, linkSafety.status)
    }
    Object.assign(updates, normalizedLinks.value)
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  if (projectPlanningSensitive) {
    const eventRef = projectRef.collection('planningDiscoveryEvents').doc()
    const mutation = await adminDb.runTransaction(async (tx) => {
      const liveProjectSnap = await tx.get(projectRef)
      if (!liveProjectSnap.exists) return { ok: false as const, status: 404, error: 'Project not found' }
      const liveProject = (liveProjectSnap.data() ?? {}) as Record<string, unknown>
      const livePlanning = liveProject.planningDiscovery as PlanningDiscoveryState | undefined
      const actor = { uid: user.uid, now: new Date().toISOString() }
      if ((livePlanning?.revision ?? 0) !== (currentPlanning?.revision ?? 0)) {
        return {
          ok: false as const,
          status: 409,
          error: 'Planning discovery revision changed; retry the project update',
          details: {
            code: 'planning_discovery_revision_conflict',
            revision: currentPlanning?.revision ?? 0,
          },
        }
      }

      if (!livePlanning?.enforced) {
        const started = applyPlanningDiscoveryAction(null, { type: 'start' }, actor)
        if (!started.ok) return started
        tx.update(projectRef, {
          planningDiscovery: started.state,
          updatedAt: FieldValue.serverTimestamp(),
        })
        tx.set(eventRef, {
          ...started.event,
          projectId,
          orgId: liveProject.orgId ?? null,
          schemaVersion: 1,
        })
        const blocker = planningMutationBlocker({ planningDiscovery: started.state })!
        return { ok: false as const, status: 409, error: blocker.message, details: blocker, discoveryStarted: true }
      }

      const blocker = planningMutationBlocker(liveProject)
      if (blocker) return { ok: false as const, status: 409, error: blocker.message, details: blocker }

      const liveMaterialPlanningReason = materialPlanningContextReason(liveProject, body as Record<string, unknown>)
      let planningTransition: Extract<PlanningActionResult, { ok: true }> | null = null
      if (liveMaterialPlanningReason) {
        const transition = applyPlanningDiscoveryAction(livePlanning, {
          type: 'reopen',
          expectedRevision: livePlanning.revision,
          reason: liveMaterialPlanningReason,
        }, actor)
        if (!transition.ok) return transition
        planningTransition = transition
      }

      tx.update(projectRef, planningTransition
        ? { ...updates, planningDiscovery: planningTransition.state }
        : updates)
      if (planningTransition) {
        tx.set(eventRef, {
          ...planningTransition.event,
          projectId,
          orgId: liveProject.orgId ?? null,
          schemaVersion: 1,
        })
      }
      return { ok: true as const }
    })
    if (!mutation.ok) return apiError(mutation.error, mutation.status, 'details' in mutation ? mutation.details ?? undefined : undefined)
  } else {
    await projectRef.update(updates)
  }

  if (orgId) {
    const summaryOrgIds = Array.from(new Set([
      orgId,
      projectData.recipientOrgId,
      projectData.targetOrgId,
      projectData.clientOrgId,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
    await Promise.all(summaryOrgIds.map((summaryOrgId) => touchPortalDashboardSummary({
      orgId: summaryOrgId,
      staleReason: 'project.updated',
    })))

    logActivity({
      orgId,
      type: 'project_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated project',
      entityId: projectId,
      entityType: 'project',
      entityTitle: (updates.name as string | undefined) ?? undefined,
    }).catch(() => {})
  }

  return apiSuccess({ id: projectId, ...updates })
})
