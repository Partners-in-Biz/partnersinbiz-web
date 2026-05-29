/**
 * /api/v1/crm/webhooks — workspace-scoped outbound webhook management.
 *
 * Mirrors the platform-admin webhook API but scopes all reads/writes to the
 * authenticated CRM workspace.
 */
import { randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { VALID_WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/types'

export const dynamic = 'force-dynamic'

function redactSecret<T extends Record<string, unknown>>(doc: T): T {
  return 'secret' in doc ? { ...doc, secret: '***' } : doc
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return true
    return parsed.protocol === 'http:' && (process.env.NODE_ENV !== 'production' || process.env.WEBHOOKS_ALLOW_HTTP === '1')
  } catch {
    return false
  }
}

export const GET = withCrmAuth('admin', async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url)
  const activeParam = searchParams.get('active')
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200)

  try {
    const snap = await adminDb
      .collection('outbound_webhooks')
      .where('orgId', '==', ctx.orgId)
      .get()

    let items = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown>))
      .filter((item) => item.orgId === ctx.orgId && item.deleted === false)
    if (activeParam === 'true') items = items.filter((item) => item.active === true)
    else if (activeParam === 'false') items = items.filter((item) => item.active === false)
    items = items
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
      .slice(0, limit)
      .map((item) => redactSecret(item))
    return apiSuccess({ items, nextCursor: null }, 200, { total: items.length, page: 1, limit })
  } catch (err) {
    console.error('[crm-webhooks-list-error]', err)
    return apiError('Failed to list webhooks', 500)
  }
})

export const POST = withCrmAuth('admin', async (req: NextRequest, ctx) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    url?: string
    events?: unknown
    secret?: string
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!name) return apiError('name is required', 400)
  if (!url) return apiError('url is required', 400)
  if (!isHttpsUrl(url)) return apiError('url must be an https URL (http allowed only in non-production)', 400)
  if (!Array.isArray(body.events) || body.events.length === 0) return apiError('events must be a non-empty array', 400)

  const invalid = (body.events as string[]).filter((event) => !VALID_WEBHOOK_EVENTS.includes(event as WebhookEvent))
  if (invalid.length) {
    return apiError(`Invalid events: ${invalid.join(', ')}. Allowed: ${VALID_WEBHOOK_EVENTS.join(', ')}`, 400)
  }

  const secret = body.secret?.trim() || randomBytes(32).toString('hex')
  const doc = {
    orgId: ctx.orgId,
    name,
    url,
    events: body.events as WebhookEvent[],
    secret,
    active: true,
    failureCount: 0,
    lastDeliveredAt: null,
    lastFailureAt: null,
    autoDisabledAt: null,
    createdBy: ctx.actor.uid,
    createdByRef: ctx.actor,
    updatedBy: ctx.actor.uid,
    updatedByRef: ctx.actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  try {
    const ref = await adminDb.collection('outbound_webhooks').add(doc)
    return apiSuccess({ id: ref.id, secretOnce: secret, secret: '***' }, 201)
  } catch (err) {
    console.error('[crm-webhooks-create-error]', err)
    return apiError('Failed to create webhook', 500)
  }
})
