import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureBookStudioAccess } from '@/lib/book-studio/api'
import { assertMinState, LifecycleStateTooLowError } from '@/lib/book-studio/lifecycle'
import {
  assembleBookProject,
  AssemblyNotFoundError,
  AssemblyNotReadyError,
  AssemblyValidationError,
} from '@/lib/book-studio/assembly/assemble'
import { AssemblyMissingAssetError } from '@/lib/book-studio/assembly/interior-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context: RouteContext) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // Empty/absent body is fine — assemble takes no payload beyond org scoping.
    body = {}
  }

  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
  if (!projectSnap.exists) return apiError('book project not found', 404)
  const project = projectSnap.data() ?? {}
  if (project.orgId !== orgId || project.deleted === true) return apiError('book project not found', 404)

  try {
    assertMinState(project, 'rights_cleared')
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) {
      return apiError(error.message, 422, { blockers: error.blockers })
    }
    throw error
  }

  try {
    const manifest = await assembleBookProject({ projectId, orgId, actor: user })
    return apiSuccess({ manifest })
  } catch (error) {
    if (error instanceof AssemblyNotFoundError) {
      return apiError('book project not found', 404)
    }
    if (error instanceof AssemblyValidationError) {
      return apiError(error.message, 400)
    }
    if (error instanceof AssemblyMissingAssetError) {
      return apiError('pages are missing required image assets', 422, { missing: error.orders })
    }
    if (error instanceof AssemblyNotReadyError) {
      return apiError(error.message, 422)
    }
    throw error
  }
})
