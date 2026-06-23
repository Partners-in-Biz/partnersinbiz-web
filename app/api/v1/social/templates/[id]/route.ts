/**
 * PATCH  /api/v1/social/templates/[id] — update a post-text template
 * DELETE /api/v1/social/templates/[id] — delete a post-text template
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const VARIABLE_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

function extractVariables(body: string): string[] {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  VARIABLE_RE.lastIndex = 0
  while ((match = VARIABLE_RE.exec(body)) !== null) {
    found.add(match[1])
  }
  return Array.from(found)
}

export const PATCH = withAuth('client', withTenant(async (req, _user, orgId) => {
  const itemId = new URL(req.url).pathname.split('/').pop()
  if (!itemId) {
    return apiError('Template ID is required', 400)
  }

  const docRef = adminDb.collection('social_templates').doc(itemId)
  const snap = await docRef.get()
  if (!snap.exists || snap.data()?.orgId !== orgId) {
    return apiError('Template not found', 404)
  }

  const body = await req.json()
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return apiError('name cannot be empty')
    }
    updates.name = name
  }

  if (typeof body.body === 'string') {
    if (!body.body.trim()) {
      return apiError('body cannot be empty')
    }
    updates.body = body.body
    // Re-extract variables when body changes.
    updates.variables = extractVariables(body.body)
  }

  if (typeof body.category === 'string' && body.category.trim()) {
    updates.category = body.category.trim()
  }

  if (Object.keys(updates).length === 1) {
    return apiError('No valid updates provided', 400)
  }

  await docRef.update(updates)
  const updated = await docRef.get()
  return apiSuccess({ id: itemId, ...updated.data() })
}))

export const DELETE = withAuth('client', withTenant(async (req, _user, orgId) => {
  const itemId = new URL(req.url).pathname.split('/').pop()
  if (!itemId) {
    return apiError('Template ID is required', 400)
  }

  const docRef = adminDb.collection('social_templates').doc(itemId)
  const snap = await docRef.get()
  if (!snap.exists || snap.data()?.orgId !== orgId) {
    return apiError('Template not found', 404)
  }

  await docRef.delete()
  return apiSuccess({ id: itemId, deleted: true })
}))
