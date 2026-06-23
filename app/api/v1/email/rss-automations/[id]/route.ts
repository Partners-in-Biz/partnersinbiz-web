// app/api/v1/email/rss-automations/[id]/route.ts
//
// GET / PUT / DELETE a single RSS digest automation.
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { sanitizeRecipient, sanitizeSchedule } from '@/lib/email/rss-automation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('rss_automations').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  return apiSuccess({ id: snap.id, ...snap.data() })
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('rss_automations').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Build a whitelisted patch — never let orgId/lastRun/dedup be overwritten
  // through the public PUT.
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.feedUrl === 'string' && body.feedUrl.trim()) {
    try {
      const u = new URL(body.feedUrl.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return apiError('feedUrl must be http(s)', 400)
      patch.feedUrl = body.feedUrl.trim()
    } catch {
      return apiError('feedUrl is not a valid URL', 400)
    }
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.schedule !== undefined) patch.schedule = sanitizeSchedule(body.schedule)
  if (typeof body.subject === 'string' && body.subject.trim()) patch.subject = body.subject.trim()
  if (typeof body.bodyHtml === 'string') patch.bodyHtml = body.bodyHtml
  if (body.recipient !== undefined) {
    const recipient = sanitizeRecipient(body.recipient)
    if (!recipient) return apiError('recipient must be a segment, tag, or non-empty contacts list', 400)
    patch.recipient = recipient
  }
  if (body.maxItems !== undefined) {
    const n = typeof body.maxItems === 'number' ? body.maxItems : parseInt(String(body.maxItems), 10)
    if (Number.isFinite(n)) patch.maxItems = Math.min(20, Math.max(1, Math.round(n)))
  }

  patch.updatedAt = FieldValue.serverTimestamp()
  await adminDb.collection('rss_automations').doc(id).update(patch)
  return apiSuccess({ id, ...patch })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('rss_automations').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  await adminDb
    .collection('rss_automations')
    .doc(id)
    .update({ deleted: true, enabled: false, updatedAt: FieldValue.serverTimestamp() })
  return apiSuccess({ id })
})
