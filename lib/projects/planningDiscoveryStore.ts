import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { canProjectRole, legacyProjectAccessForUser } from '@/lib/projects/collaboration'
import {
  applyPlanningDiscoveryAction,
  planningMutationBlocker,
  preparePlanningContextMutation,
  type PlanningActionResult,
  type PlanningDiscoveryState,
} from '@/lib/projects/planningDiscovery'

type PlanningBlocker = NonNullable<ReturnType<typeof planningMutationBlocker>>
type PlanningEvent = Record<string, unknown>

export type PlanningContextMutationTransition =
  | {
      allowed: true
      state: PlanningDiscoveryState
      event: PlanningEvent
    }
  | {
      allowed: false
      blocker: PlanningBlocker
      state?: PlanningDiscoveryState
      event?: PlanningEvent
    }

export function canMutateLinkedProjectPlanning(
  project: Record<string, unknown>,
  user: ApiUser,
  documentOrgId?: string,
): boolean {
  const scopedOrgId = documentOrgId?.trim() || user.activeOrgId?.trim() || user.orgId?.trim() || ''
  const isUnscopedPlatformAdmin = user.role === 'admin' && isSuperAdmin(user)
  if (!scopedOrgId && !isUnscopedPlatformAdmin) return false

  const access = legacyProjectAccessForUser(user, project, scopedOrgId || undefined)
  return Boolean(access && canProjectRole(access.role, 'write'))
}

export function planningContextMutationTransition(
  project: Record<string, unknown>,
  input: { uid: string; now: string; reason: string },
): PlanningContextMutationTransition {
  const current = project.planningDiscovery as PlanningDiscoveryState | undefined
  const blocker = planningMutationBlocker(project)

  if (blocker) {
    if (!current?.enforced) {
      const started = applyPlanningDiscoveryAction(null, { type: 'start' }, input)
      if (started.ok) {
        return {
          allowed: false,
          blocker,
          state: started.state,
          event: started.event,
        }
      }
    }
    return { allowed: false, blocker }
  }

  const reopened: PlanningActionResult = preparePlanningContextMutation(
    project,
    input,
    input.reason,
  )
  if (!reopened.ok) {
    return {
      allowed: false,
      blocker: {
        code: 'planning_discovery_required',
        message: reopened.error,
        revision: current?.revision ?? 0,
      },
    }
  }

  return {
    allowed: true,
    state: reopened.state,
    event: reopened.event,
  }
}
