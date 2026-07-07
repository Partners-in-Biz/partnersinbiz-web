// POST /api/v1/book-studio/projects/[id]/transition
//
// The only legal admin-side way to change a book project's lifecycleState.
// Direct PATCH writes to lifecycleState are rejected 403 at the generic
// PATCH routes (see findLifecycleStateWriteAttempt in lib/book-studio/routes.ts
// and the portal [resource]/[id] route) — this route is the sole path that
// runs guard checks and writes lifecycleState + a decision log, both inside
// one Firestore transaction (see executeLifecycleTransition).
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureBookStudioAccess } from '@/lib/book-studio/api'
import {
  executeLifecycleTransition,
  isValidLifecycleState,
  LifecycleReopenReasonRequiredError,
  LifecycleStateTooLowError,
  LifecycleTransitionNotAllowedError,
} from '@/lib/book-studio/lifecycle'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const toState = body.toState
  if (!isValidLifecycleState(toState)) return apiError('toState must be a valid lifecycle state', 400)
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const guardData = await loadGuardData(projectId, toState)

  try {
    const result = await executeLifecycleTransition({
      db: adminDb, orgId, projectId, toState, guardData, reason,
      actor: { uid: user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' },
    })
    return apiSuccess(result)
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) return apiError(error.message, 422, { blockers: error.blockers })
    if (error instanceof LifecycleTransitionNotAllowedError) return apiError(error.message, 400)
    if (error instanceof LifecycleReopenReasonRequiredError) return apiError(error.message, 400)
    throw error
  }
})

// Loads exactly the data the guard for `toState` needs. Kept in the route
// (not lifecycle.ts) because it is the only place allowed to call adminDb —
// lifecycle.ts guards stay pure/unit-testable per the lifecycle module's design.
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
