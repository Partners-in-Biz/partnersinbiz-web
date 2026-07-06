// POST /api/v1/portal/book-studio/projects/[id]/request-draft
//
// Portal users cannot dispatch AI generation directly (Hermes runtime
// dispatch is a locked-off V1 constraint — see findBookStudioRuntimeDispatchFields
// and the 403s in the [resource]/[id] PATCH route). Instead this route creates
// a governed platform TASK for the PiB team to action, plus a decision-log
// entry recording the request. It never triggers generation itself.
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { resolveBookStudioCapabilities } from '@/lib/book-studio/capabilities'
import { portalBookStudioGuard, portalActorFields } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

const UNIT_TYPES = new Set(['chapter', 'page', 'cover', 'research'])
// Task statuses that count as an "open" request already in flight — see
// lib/tasks/types.ts VALID_TASK_STATUSES ('todo' | 'in_progress' | 'done' | 'cancelled').
const OPEN_TASK_STATUSES = ['todo', 'in_progress'] as const

type Ctx = { params: Promise<{ id: string }> }

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const unitType = typeof body.unitType === 'string' ? body.unitType : ''
  if (!UNIT_TYPES.has(unitType)) {
    return apiError(`Invalid unitType; expected one of ${Array.from(UNIT_TYPES).join(' | ')}`, 400)
  }
  const unitId = typeof body.unitId === 'string' && body.unitId.trim() ? body.unitId.trim() : undefined
  let note: string | undefined
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') return apiError('note must be a string', 400)
    if (body.note.length > 2000) return apiError('note must be 2000 characters or fewer', 400)
    note = body.note.trim() || undefined
  }

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error

  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps.canEdit) return apiError('Your role does not have access to this Book Studio action', 403)

  const projectRef = adminDb.collection('book_studio_projects').doc(projectId)
  const projectSnap = await projectRef.get()
  const project = projectSnap.exists ? projectSnap.data() ?? {} : null
  if (!project || project.orgId !== orgId || project.deleted === true) {
    return apiError('Book project not found', 404)
  }

  const requestKey = `book-draft:${projectId}:${unitType}:${unitId || 'project'}`

  const existingSnap = await adminDb
    .collection('tasks')
    .where('orgId', '==', orgId)
    .where('requestKey', '==', requestKey)
    .get()
  const hasOpenRequest = existingSnap.docs.some((doc) => {
    const data = doc.data() as Record<string, unknown>
    return data.deleted !== true && OPEN_TASK_STATUSES.includes(data.status as (typeof OPEN_TASK_STATUSES)[number])
  })
  if (hasOpenRequest) {
    return apiError('An AI draft request for this item is already open', 409)
  }

  const projectTitle = typeof project.title === 'string' && project.title.trim() ? project.title.trim() : 'Untitled book project'
  const unitLabel = `${unitType}${unitId ? ` ${unitId}` : ''}`
  const title = `AI draft requested: ${projectTitle} (${unitLabel})`
  const descriptionParts = [`Client requested an AI draft for ${unitLabel} on book project "${projectTitle}".`]
  if (note) descriptionParts.push(`Note from client: ${note}`)
  const description = descriptionParts.join('\n\n')

  const taskRef = await adminDb.collection('tasks').add({
    orgId,
    title,
    description,
    status: 'todo',
    priority: 'normal',
    dueDate: null,
    assignedTo: null,
    projectId: null,
    contactId: null,
    dealId: null,
    tags: ['book-studio', 'ai-draft-request'],
    columnId: 'todo',
    requestKey,
    linkedResource: {
      type: 'book_studio_project',
      id: projectId,
      unitType,
      unitId: unitId ?? null,
    },
    ...portalActorFields(uid),
    completedAt: null,
    deleted: false,
  })

  const summary = `Client requested an AI draft (${unitLabel}). Task ${taskRef.id}.`
  await adminDb.collection('book_studio_decision_logs').add({
    orgId,
    projectId,
    decision: 'ai_draft_requested_from_portal',
    title: 'AI draft requested from portal',
    safeSummary: summary,
    taskId: taskRef.id,
    ...portalActorFields(uid),
  })

  return apiSuccess({ taskId: taskRef.id, requestKey }, 201)
})
