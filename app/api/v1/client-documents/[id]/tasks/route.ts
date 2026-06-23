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

/** Validate that a value is an ISO-ish date string (yyyy-mm-dd) that parses to a real date. */
function parseDueDate(value: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false }
  const time = Date.parse(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(time)) return { ok: false }
  // Guard against roll-over values like 2026-02-30 that Date.parse accepts loosely.
  const d = new Date(time)
  const reconstructed = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
  if (reconstructed !== trimmed) return { ok: false }
  return { ok: true, value: trimmed }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return apiError('title is required', 400)

  const assignee = typeof body.assignee === 'string' ? body.assignee.trim() : ''

  let dueDate = ''
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
    const parsed = parseDueDate(body.dueDate)
    if (!parsed.ok) return apiError('dueDate must be a valid date (yyyy-mm-dd)', 400)
    dueDate = parsed.value
  }

  const orgId = access.document.orgId ?? ''

  const ref = adminDb.collection('document_tasks').doc()
  const task = {
    documentId: id,
    orgId,
    title,
    completed: false,
    // Omit empty optional fields — Firestore rejects `undefined`.
    ...(assignee ? { assignee } : {}),
    ...(dueDate ? { dueDate } : {}),
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

  // Build the update from only the fields that were provided. `completed` is now optional.
  const update: Record<string, unknown> = {}

  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') return apiError('completed must be a boolean', 400)
    update.completed = body.completed
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return apiError('title must be a string', 400)
    const title = body.title.trim()
    if (!title) return apiError('title cannot be empty', 400)
    update.title = title
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null && typeof body.assignee !== 'string') {
      return apiError('assignee must be a string', 400)
    }
    const assignee = typeof body.assignee === 'string' ? body.assignee.trim() : ''
    // Empty string clears the assignee.
    update.assignee = assignee ? assignee : FieldValue.delete()
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') {
      // Clear the due date.
      update.dueDate = FieldValue.delete()
    } else {
      const parsed = parseDueDate(body.dueDate)
      if (!parsed.ok) return apiError('dueDate must be a valid date (yyyy-mm-dd)', 400)
      update.dueDate = parsed.value
    }
  }

  if (Object.keys(update).length === 0) {
    return apiError('No updatable fields provided', 400)
  }

  const taskRef = adminDb.collection('document_tasks').doc(taskId)
  const taskSnap = await taskRef.get()
  if (!taskSnap.exists) return apiError('Task not found', 404)
  const taskData = taskSnap.data() as { documentId?: string }
  if (taskData.documentId !== id) return apiError('Task does not belong to this document', 403)

  update.updatedAt = FieldValue.serverTimestamp()
  update.updatedBy = user.uid

  await taskRef.update(update)

  // Build a clean response (FieldValue.delete() sentinels → null in the payload).
  const responsePayload: Record<string, unknown> = { id: taskId, updatedAt: null, updatedBy: user.uid }
  for (const key of ['completed', 'title', 'assignee', 'dueDate'] as const) {
    if (key in update) {
      const v = update[key]
      responsePayload[key] = v instanceof FieldValue ? null : v
    }
  }

  return apiSuccess(responsePayload)
})
