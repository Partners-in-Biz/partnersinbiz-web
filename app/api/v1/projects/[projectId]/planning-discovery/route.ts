import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import {
  applyPlanningDiscoveryAction,
  isPlanningDiscoveryActionType,
  type PlanningDiscoveryState,
} from '@/lib/projects/planningDiscovery'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function publicSummary(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const state = value as PlanningDiscoveryState
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    status: state.status,
    mode: state.mode,
    enforced: state.enforced,
    inspection: state.inspection ?? null,
    turns: state.turns ?? [],
    pendingQuestionId: state.pendingQuestionId ?? null,
    predictedNextAnswers: state.predictedNextAnswers ?? [],
    intentBlockingUnknowns: state.intentBlockingUnknowns ?? [],
    confidence: state.confidence ?? null,
    brief: state.brief ?? null,
    digest: state.digest ?? null,
    snapshots: state.snapshots ?? [],
    startedBy: state.startedBy ?? null,
    startedAt: state.startedAt ?? null,
    updatedBy: state.updatedBy ?? null,
    updatedAt: state.updatedAt ?? null,
    confirmedBy: state.confirmedBy ?? null,
    confirmedAt: state.confirmedAt ?? null,
    attestationReason: state.attestationReason ?? null,
    acknowledgesPreservedOperationalGates: state.acknowledgesPreservedOperationalGates === true,
  }
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const explicitOrgId = _req.headers.get('x-org-id')?.trim() || ''
  if (user.role === 'ai' && !explicitOrgId) return apiError('X-Org-Id is required for agent planning access', 400)
  const access = await getProjectForUser(projectId, user, explicitOrgId || user.orgId || undefined)
  if (!access.ok) return apiError(access.error, access.status)
  const project = access.doc.data() ?? {}
  return apiSuccess({ planningDiscovery: publicSummary(project.planningDiscovery) })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const explicitOrgId = req.headers.get('x-org-id')?.trim() || ''
  if (user.role === 'ai' && !explicitOrgId) return apiError('X-Org-Id is required for agent planning access', 400)
  const access = await getProjectForUser(projectId, user, explicitOrgId || user.orgId || undefined)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'manage_project')) {
    return apiError('Project manager access is required for planning confirmation', 403)
  }

  const action = await req.json().catch(() => null)
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return apiError('A planning discovery action is required', 400)
  if (!isPlanningDiscoveryActionType(action.type)) return apiError('Unknown planning discovery action', 400)
  const terminalHumanActions = new Set(['confirm', 'plan_with_assumptions', 'reopen'])
  if (terminalHumanActions.has(action.type) && (user.role === 'ai' || user.authKind === 'user_delegation')) {
    return apiError('A direct human project manager must confirm, reopen, or attest the Decision Brief', 403)
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const eventRef = projectRef.collection('planningDiscoveryEvents').doc()
  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(projectRef)
      if (!snap.exists) return { ok: false as const, error: 'Project not found', status: 404 }
      const project = snap.data() ?? {}
      const transition = applyPlanningDiscoveryAction(
        (project.planningDiscovery as PlanningDiscoveryState | undefined) ?? null,
        action,
        { uid: user.uid, now: new Date().toISOString() },
      )
      if (!transition.ok) return transition
      tx.update(projectRef, { planningDiscovery: transition.state, updatedAt: new Date() })
      if (transition.state.brief && transition.state.digest) {
        tx.set(projectRef.collection('decisionBriefs').doc(transition.state.digest), {
          projectId,
          orgId: project.orgId ?? null,
          digest: transition.state.digest,
          revision: transition.state.revision,
          status: transition.state.status,
          mode: transition.state.mode,
          confidence: transition.state.confidence ?? null,
          inspection: transition.state.inspection ?? null,
          turns: transition.state.turns ?? [],
          predictedNextAnswers: transition.state.predictedNextAnswers ?? [],
          intentBlockingUnknowns: transition.state.intentBlockingUnknowns ?? [],
          brief: transition.state.brief,
          confirmedBy: transition.state.confirmedBy ?? null,
          confirmedAt: transition.state.confirmedAt ?? null,
          attestationReason: transition.state.attestationReason ?? null,
          acknowledgesPreservedOperationalGates: transition.state.acknowledgesPreservedOperationalGates === true,
          updatedBy: user.uid,
          updatedAt: new Date(),
        }, { merge: true })
      }
      tx.set(eventRef, {
        ...transition.event,
        projectId,
        orgId: project.orgId ?? null,
        schemaVersion: 1,
      })
      return transition
    })
    if (!result.ok) return apiError(result.error, result.status)
    return apiSuccess({ planningDiscovery: publicSummary(result.state), eventId: eventRef.id })
  } catch (error) {
    console.error('[planning-discovery-update-error]', error)
    return apiError('Planning discovery update failed', 500)
  }
})
