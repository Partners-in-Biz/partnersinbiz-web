// POST /api/v1/portal/book-studio/projects/[id]/transition
//
// Portal counterpart of the admin transition route. Capability-gated:
// roles without canApprovalGates may only progress a project up to
// content_complete (they cannot clear rights, assemble, QA-approve,
// submit, publish, or reopen a project past that point).
import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { portalBookStudioGuard } from '@/lib/book-studio/portal'
import { resolveBookStudioCapabilities } from '@/lib/book-studio/capabilities'
import {
  LIFECYCLE_STATES,
  executeLifecycleTransition,
  isValidLifecycleState,
  LifecycleReopenReasonRequiredError,
  LifecycleStateTooLowError,
  LifecycleTransitionNotAllowedError,
} from '@/lib/book-studio/lifecycle'
import type { BookLifecycleState } from '@/lib/book-studio/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Index in LIFECYCLE_STATES a caller without canApprovalGates may not pass.
const CONTENT_COMPLETE_RANK = LIFECYCLE_STATES.indexOf('content_complete')

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps.canEdit) return apiError('Your role does not have access to this Book Studio action', 403)

  const toState = body.toState
  if (!isValidLifecycleState(toState)) return apiError('toState must be a valid lifecycle state', 400)

  const targetRank = LIFECYCLE_STATES.indexOf(toState as BookLifecycleState)
  if (!caps.canApprovalGates && targetRank > CONTENT_COMPLETE_RANK) {
    return apiError('Your role can only progress Book Studio projects up to "content_complete"', 403)
  }

  const reason = typeof body.reason === 'string' ? body.reason : undefined
  const guardData = await loadGuardData(projectId, toState)

  try {
    const result = await executeLifecycleTransition({
      db: adminDb, orgId, projectId, toState, guardData, reason,
      actor: { uid, actorType: 'user' },
    })
    return apiSuccess(result)
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) return apiError(error.message, 422, { blockers: error.blockers })
    if (error instanceof LifecycleTransitionNotAllowedError) return apiError(error.message, 400)
    if (error instanceof LifecycleReopenReasonRequiredError) return apiError(error.message, 400)
    throw error
  }
})

async function loadGuardData(projectId: string, toState: string) {
  if (toState === 'content_complete') {
    const [chaptersSnap, pagesSnap] = await Promise.all([
      adminDb.collection('book_studio_chapters').where('projectId', '==', projectId).get(),
      adminDb.collection('book_studio_pages').where('projectId', '==', projectId).get(),
    ])
    return {
      chapters: chaptersSnap.docs.map((doc) => doc.data()),
      pages: pagesSnap.docs.map((doc) => doc.data()),
    }
  }
  if (toState === 'rights_cleared' || toState === 'assembled' || toState === 'qa_approved') {
    const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
    const project = projectSnap.data() ?? {}
    return { rightsLedger: project.rightsLedger, packageManifest: project.packageManifest }
  }
  return {}
}
