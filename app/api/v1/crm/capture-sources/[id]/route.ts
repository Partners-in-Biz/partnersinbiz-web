/**
 * GET    /api/v1/crm/capture-sources/[id]
 * PUT    /api/v1/crm/capture-sources/[id]   — update editable fields
 * DELETE /api/v1/crm/capture-sources/[id]   — soft-delete
 *
 * PUT supports field `rotateKey: true` to regenerate the publicKey
 * (immediately invalidates any deployed form widgets / integrations).
 *
 * Auth: GET → viewer+, PUT/DELETE → admin+
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { generatePublicKey, type CaptureSource } from '@/lib/crm/captureSources'

type RouteCtx = { params: Promise<{ id: string }> }

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Tenant-scoped loader — returns 404 for missing OR cross-org OR deleted docs
// ---------------------------------------------------------------------------

async function loadCaptureSource(id: string, ctxOrgId: string) {
  const ref = adminDb.collection('capture_sources').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false as const, status: 404, error: 'Capture source not found' }
  const data = snap.data()!
  if (data.orgId !== ctxOrgId) return { ok: false as const, status: 404, error: 'Capture source not found' }
  if (data.deleted === true) return { ok: false as const, status: 404, error: 'Capture source not found' }
  return { ok: true as const, ref, snap, data }
}

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadCaptureSource(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)
  return apiSuccess({ id, ...r.data } as CaptureSource)
})

// ---------------------------------------------------------------------------
// PUT — admin+
// ---------------------------------------------------------------------------

export const PUT = withCrmAuth<RouteCtx>('admin', async (req: NextRequest, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadCaptureSource(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)

  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef = ctx.actor

  const editable: Record<string, unknown> = {}
  if (typeof body.name === 'string') editable.name = body.name.trim()
  if (typeof body.enabled === 'boolean') editable.enabled = body.enabled
  if (Array.isArray(body.autoTags)) editable.autoTags = stringList(body.autoTags)
  if (Array.isArray(body.autoCampaignIds)) editable.autoCampaignIds = stringList(body.autoCampaignIds)
  if (Array.isArray(body.autoSequenceIds)) editable.autoSequenceIds = stringList(body.autoSequenceIds)
  if (typeof body.redirectUrl === 'string') editable.redirectUrl = body.redirectUrl
  if (typeof body.consentRequired === 'boolean') editable.consentRequired = body.consentRequired
  if (body.rotateKey === true) editable.publicKey = generatePublicKey()

  if (Object.keys(editable).length === 0) {
    return apiError('No editable fields supplied', 400)
  }

  editable.updatedByRef = actorRef
  editable.updatedAt = FieldValue.serverTimestamp()

  // Omit updatedBy uid for agent calls
  if (!ctx.isAgent) {
    editable.updatedBy = ctx.actor.uid
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(editable).filter(([, v]) => v !== undefined))
  await r.ref.update(sanitized)

  const updated = await r.ref.get()
  return apiSuccess({ id, ...updated.data() } as CaptureSource)
})

// ---------------------------------------------------------------------------
// DELETE — admin+
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadCaptureSource(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)

  // PR 3 pattern 1: use ctx.actor directly
  const actorRef = ctx.actor

  const deletePatch: Record<string, unknown> = {
    deleted: true,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Omit updatedBy uid for agent calls
  if (!ctx.isAgent) {
    deletePatch.updatedBy = ctx.actor.uid
  }

  // Firestore rejects undefined values — strip before write
  const sanitized = Object.fromEntries(
    Object.entries(deletePatch).filter(([, v]) => v !== undefined),
  )
  await r.ref.update(sanitized)

  return apiSuccess({ id })
})
