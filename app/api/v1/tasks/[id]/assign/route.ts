/**
 * POST /api/v1/tasks/:id/assign — assign the task to a user or agent
 *
 * Body: { assignedTo: { type: 'user' | 'agent', id: string } }
 * Auth: admin (AI/admin)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { lastActorFrom } from '@/lib/api/actor'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  VALID_ASSIGNEE_TYPES,
  type Task,
  type TaskAssignee,
} from '@/lib/tasks/types'
import { applyAgentDispatchDefaultsForStandaloneAssignment } from '@/lib/tasks/agentState'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const ref = adminDb.collection('tasks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Task not found', 404)
  const existing = doc.data() as Task | undefined
  if (!existing || existing.deleted === true) {
    return apiError('Task not found', 404)
  }

  const body = (await req.json()) as { assignedTo?: TaskAssignee }
  const assignedTo = body.assignedTo

  if (
    !assignedTo ||
    !VALID_ASSIGNEE_TYPES.includes(assignedTo.type) ||
    !assignedTo.id?.trim()
  ) {
    return apiError("Invalid assignedTo; expected { type: 'user'|'agent', id }")
  }

  const updates: Record<string, unknown> = {
    assignedTo,
    ...lastActorFrom(user),
  }
  applyAgentDispatchDefaultsForStandaloneAssignment(updates, body as unknown as Record<string, unknown>, existing as unknown as Record<string, unknown>)

  await ref.update(updates)

  await adminDb.collection('notifications').add({
    orgId: existing.orgId,
    userId: assignedTo.type === 'user' ? assignedTo.id : null,
    agentId: assignedTo.type === 'agent' ? assignedTo.id : null,
    type: 'task.assigned',
    title: 'Task assigned to you',
    body: `"${existing.title}" — due ${existing.dueDate ?? 'no date'}`,
    link: `/portal/projects?task=${id}`,
    status: 'unread',
    priority: existing.priority,
    createdAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id, assignedTo })
})
