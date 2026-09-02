// app/api/v1/email-templates/[id]/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import { lastActorFrom } from '@/lib/api/actor'
import { validateDocument } from '@/lib/email-builder/validate'
import { findStarter, isStarterId, type TemplateCategory } from '@/lib/email-builder/templates'
import type { ApiUser } from '@/lib/api/types'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const CATEGORIES: TemplateCategory[] = ['newsletter', 'welcome', 'product-launch', 'reengagement', 'transactional', 'custom']
function isCategory(v: unknown): v is TemplateCategory {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v)
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  if (isStarterId(id)) {
    const starter = findStarter(id)
    if (!starter) return apiError('Not found', 404)
    return apiSuccess(starter)
  }

  const snap = await adminDb.collection('email_templates').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  return apiSuccess({
    id: snap.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
  })
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  if (isStarterId(id)) return apiError('Starter templates are read-only. Duplicate first.', 403)

  const snap = await adminDb.collection('email_templates').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) updates.name = body.name.trim()
  if (typeof body.description === 'string') updates.description = body.description
  if (body.category !== undefined) {
    if (!isCategory(body.category)) return apiError('category must be one of ' + CATEGORIES.join(', '), 400)
    updates.category = body.category
  }
  if (body.document !== undefined) {
    const v = validateDocument(body.document)
    if (!v.ok) return apiError('Invalid document: ' + v.errors.join('; '), 400)
    updates.document = v.doc
  }
  if ('clientVisibility' in body) Object.assign(updates, clientVisibilityFieldsForWrite(body.clientVisibility))

  if (Object.keys(updates).length === 0) return apiError('No valid fields to update', 400)

  Object.assign(updates, lastActorFrom(user))
  await adminDb.collection('email_templates').doc(id).update(updates)
  return apiSuccess({ id, ...updates, updatedAt: null })
})

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  if (isStarterId(id)) return apiError('Starter templates cannot be deleted.', 403)

  const snap = await adminDb.collection('email_templates').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  await adminDb.collection('email_templates').doc(id).update({
    deleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  })
  return apiSuccess({ id })
})
