/**
 * GET  /api/v1/social/templates — list org's post-text templates (US-071)
 * POST /api/v1/social/templates — create a post-text template
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const VARIABLE_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

/** Extract unique `{{variable}}` names from post-text body, preserving first-seen order. */
function extractVariables(body: string): string[] {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  VARIABLE_RE.lastIndex = 0
  while ((match = VARIABLE_RE.exec(body)) !== null) {
    found.add(match[1])
  }
  return Array.from(found)
}

export const GET = withAuth('client', withTenant(async (_req, _user, orgId) => {
  const snapshot = await adminDb
    .collection('social_templates')
    .where('orgId', '==', orgId)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templates = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))

  // Sort newest first in-code to avoid composite index requirements.
  templates.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aMs = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    const bMs = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    return bMs - aMs
  })

  return apiSuccess(templates, 200, { total: templates.length })
}))

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  const body = await req.json()

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const postBody = typeof body.body === 'string' ? body.body : ''

  if (!name) {
    return apiError('name is required')
  }
  if (!postBody.trim()) {
    return apiError('body is required')
  }

  // Dedupe by name (case-insensitive) per org.
  const existing = await adminDb
    .collection('social_templates')
    .where('orgId', '==', orgId)
    .get()
  const nameLower = name.toLowerCase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dup = existing.docs.some((doc: any) =>
    String(doc.data().name ?? '').trim().toLowerCase() === nameLower
  )
  if (dup) {
    return apiError('A template with this name already exists', 409)
  }

  // Merge auto-extracted variables with any explicitly-passed ones, deduped.
  const explicit = Array.isArray(body.variables)
    ? body.variables.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '')
    : []
  const variables = Array.from(new Set([...extractVariables(postBody), ...explicit]))

  const doc = {
    orgId,
    name,
    body: postBody,
    category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'general',
    variables,
    usageCount: 0,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_templates').add(doc)

  return apiSuccess({ id: docRef.id }, 201)
}))
