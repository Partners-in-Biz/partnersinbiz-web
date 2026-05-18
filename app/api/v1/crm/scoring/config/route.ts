/**
 * GET  /api/v1/crm/scoring/config  — fetch per-org scoring config (viewer+)
 * PUT  /api/v1/crm/scoring/config  — update per-org scoring config (admin+)
 *
 * GET bootstraps a default in-memory config if the Firestore doc is absent
 * (does NOT write to Firestore).
 *
 * PUT sanitizes the body (NEVER_FROM_BODY denylist), merges into the existing
 * doc, and stamps updatedBy/updatedAt. First write also stamps createdAt.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getOrBootstrapConfig, sanitizeConfigForWrite } from '@/lib/scoring/store'

export const dynamic = 'force-dynamic'

const CONFIG_COLLECTION = 'scoringConfig'

// ---------------------------------------------------------------------------
// GET — viewer+
// ---------------------------------------------------------------------------

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  const config = await getOrBootstrapConfig(ctx.orgId)
  return apiSuccess({ config })
})

// ---------------------------------------------------------------------------
// PUT — admin+
// ---------------------------------------------------------------------------

export const PUT = withCrmAuth('admin', async (req, ctx) => {
  // Empty-body guard
  const bodyText = await req.text()
  if (!bodyText || bodyText === '{}' || bodyText.trim() === '') {
    return apiError('Request body is required', 400)
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(bodyText)
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return apiError('Request body is required', 400)
  }

  // Strip NEVER_FROM_BODY fields
  const sanitized = sanitizeConfigForWrite(body)

  const actorRef = ctx.actor
  const docRef = adminDb.collection(CONFIG_COLLECTION).doc(ctx.orgId)

  // Check if this is a first write (to stamp createdAt)
  const existing = await docRef.get()
  const isFirstWrite = !existing.exists

  const writePayload: Record<string, unknown> = {
    ...sanitized,
    orgId: ctx.orgId,
    updatedBy: actorRef.uid,
    updatedByRef: actorRef,
    updatedAt: Timestamp.now(),
  }

  if (isFirstWrite) {
    writePayload.createdAt = Timestamp.now()
    writePayload.createdBy = actorRef.uid
    writePayload.createdByRef = actorRef
  }

  await docRef.set(writePayload, { merge: true })

  // Return the merged config
  const updated = await getOrBootstrapConfig(ctx.orgId)
  return apiSuccess({ config: updated })
})
