import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const snap = await adminDb
    .collection('document_tasks')
    .where('documentId', '==', id)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get()

  const tasks = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return apiSuccess(tasks)
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  const orgId = access.document.orgId ?? ''

  const ref = adminDb.collection('document_tasks').doc()
  const task = {
    documentId: id,
    orgId,
    title,
    completed: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: user.uid,
  }
  await ref.set(task)

  return apiSuccess({ id: ref.id, ...task, createdAt: null }, 201)
})

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
  if (!taskId) return apiError('taskId is required', 400)
  if (typeof body.completed !== 'boolean') return apiError('completed must be a boolean', 400)

  const taskRef = adminDb.collection('document_tasks').doc(taskId)
  const taskSnap = await taskRef.get()
  if (!taskSnap.exists) return apiError('Task not found', 404)
  const taskData = taskSnap.data() as { documentId?: string }
  if (taskData.documentId !== id) return apiError('Task does not belong to this document', 403)

  await taskRef.update({
    completed: body.completed,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  })

  return apiSuccess({ id: taskId, completed: body.completed })
})
