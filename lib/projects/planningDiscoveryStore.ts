import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import {
  canProjectRole,
  resolveProjectAccessForUser,
} from '@/lib/projects/collaboration'
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
      state?: PlanningDiscoveryState
      event?: PlanningEvent
    }
  | {
      allowed: false
      blocker: PlanningBlocker
      state?: PlanningDiscoveryState
      event?: PlanningEvent
    }

export async function canMutateLinkedProjectPlanning(
  projectId: string,
  project: Record<string, unknown>,
  user: ApiUser,
  options: {
    documentOrgId?: string
    /** When omitted, item-scoped grants cannot create unscoped project-linked documents. */
    item?: string
  } = {},
): Promise<boolean> {
  const scopedOrgId = options.documentOrgId?.trim() || user.activeOrgId?.trim() || user.orgId?.trim() || ''
  const isUnscopedPlatformAdmin = user.role === 'admin' && isSuperAdmin(user)
  if (!scopedOrgId && !isUnscopedPlatformAdmin) return false

  const access = await resolveProjectAccessForUser(
    projectId,
    user,
    project,
    scopedOrgId || undefined,
    {
      action: 'project.write',
      ...(options.item ? { item: options.item } : {}),
    },
  )
  if (!access || !canProjectRole(access.role, 'write')) return false

  // Creating a new linked document has no durable item id yet. An item-scoped
  // grant must not mint unscoped project artifacts through client-documents.
  if (!options.item && (access.crossOrgGrant?.items.length ?? 0) > 0) return false

  return true
}

export function planningContextMutationTransition(
  project: Record<string, unknown>,
  input: { uid: string; now: string; reason: string; reopenWhenReady?: boolean },
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

  // Creating a planned artifact is an output of the confirmed brief, not a
  // change to the brief's intent. It still requires live planning readiness,
  // but must not immediately make the gate stale again.
  if (input.reopenWhenReady === false) return { allowed: true }

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
