/**
 * /api/v1/crm/webhooks/[id] — workspace-scoped single webhook CRUD.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { VALID_WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/types'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

function redactSecret<T extends Record<string, unknown>>(doc: T): T {
  return 'secret' in doc ? { ...doc, secret: '***' } : doc
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

async function loadWebhook(id: string, orgId: string) {
  const ref = adminDb.collection('outbound_webhooks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return { ref, data: null }
  const data = { id: doc.id, ...doc.data() } as Record<string, unknown>
  if (data.deleted === true || data.orgId !== orgId) return { ref, data: null }
  return { ref, data }
}

export const GET = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const { data } = await loadWebhook(id, ctx.orgId)
  if (!data) return apiError('Webhook not found', 404)
  return apiSuccess({ webhook: redactSecret(data) })
})

export const PUT = withCrmAuth<RouteCtx>('admin', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    url?: string
    events?: unknown
    active?: boolean
  }
  const { ref, data } = await loadWebhook(id, ctx.orgId)
  if (!data) return apiError('Webhook not found', 404)

  const updates: Record<string, unknown> = {
    updatedBy: ctx.actor.uid,
    updatedByRef: ctx.actor,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return apiError('name cannot be empty', 400)
    updates.name = name
  }
  if (body.url !== undefined) {
    const url = String(body.url).trim()
    if (!url || !isHttpsUrl(url)) {
      return apiError('url must be an https URL (http allowed only in non-production)', 400)
    }
    updates.url = url
  }
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return apiError('events must be a non-empty array', 400)
    }
    const invalid = (body.events as string[]).filter((event) => !VALID_WEBHOOK_EVENTS.includes(event as WebhookEvent))
    if (invalid.length) {
      return apiError(`Invalid events: ${invalid.join(', ')}. Allowed: ${VALID_WEBHOOK_EVENTS.join(', ')}`, 400)
    }
    updates.events = body.events as WebhookEvent[]
  }
  if (body.active !== undefined) updates.active = Boolean(body.active)

  try {
    await ref.update(updates)
    return apiSuccess({ id })
  } catch (err) {
    console.error('[crm-webhook-update-error]', err)
    return apiError('Failed to update webhook', 500)
  }
})

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const { ref, data } = await loadWebhook(id, ctx.orgId)
  if (!data) return apiError('Webhook not found', 404)

  try {
    await ref.update({
      deleted: true,
      active: false,
      deletedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.actor.uid,
      updatedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ deleted: true })
  } catch (err) {
    console.error('[crm-webhook-delete-error]', err)
    return apiError('Failed to delete webhook', 500)
  }
})
