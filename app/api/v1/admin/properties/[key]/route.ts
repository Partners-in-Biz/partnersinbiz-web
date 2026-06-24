/**
 * PUT    /api/v1/admin/properties/[key] — edit an existing flag definition
 *        (description / defaultValue / type). 404 if the flag does not exist.
 * DELETE /api/v1/admin/properties/[key] — delete a flag definition. Records the
 *        orphaned per-org override count in the audit metadata.
 *
 * Auth: admin. All mutations are audited.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import { FLAGS_COLLECTION, coerceValue, isFlagType, toFlagDef, type FlagType } from '../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ key: string }> }

async function countOverrides(key: string): Promise<number> {
  const orgsSnap = await adminDb.collection('organizations').limit(300).get()
  let count = 0
  for (const doc of orgsSnap.docs) {
    const ff = (doc.data() as Record<string, unknown>).featureFlags
    if (ff && typeof ff === 'object' && key in (ff as Record<string, unknown>)) count += 1
  }
  return count
}

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { key } = await (ctx as RouteContext).params
  const ref = adminDb.collection(FLAGS_COLLECTION).doc(key)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Feature flag not found', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const current = snap.data() as Record<string, unknown>
  const nextType: FlagType = body.type !== undefined
    ? (String(body.type).trim() as FlagType)
    : (isFlagType(current.type) ? current.type : 'boolean')
  if (!isFlagType(nextType)) return apiError('type must be one of boolean, string, number', 400)

  const update: Record<string, unknown> = { type: nextType, updatedAt: FieldValue.serverTimestamp() }

  if (body.description !== undefined) update.description = String(body.description).trim()

  // Re-coerce the default value whenever a new default OR a new type is supplied.
  if (body.defaultValue !== undefined || body.type !== undefined) {
    const rawDefault = body.defaultValue !== undefined ? body.defaultValue : current.defaultValue
    try {
      update.defaultValue = coerceValue(nextType, rawDefault)
    } catch (e) {
      return apiError(e instanceof Error ? e.message : 'Invalid defaultValue for type', 400)
    }
  }

  await ref.set(update, { merge: true })

  await writeAdminAudit(user, {
    action: 'feature_flag.upsert',
    summary: `Edited feature flag "${key}"`,
    metadata: { key, ...update, updatedAt: undefined },
  })

  const saved = await ref.get()
  return apiSuccess(toFlagDef(key, saved.data() as Record<string, unknown>))
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { key } = await (ctx as RouteContext).params
  const ref = adminDb.collection(FLAGS_COLLECTION).doc(key)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Feature flag not found', 404)

  const overrideCount = await countOverrides(key)
  await ref.delete()

  await writeAdminAudit(user, {
    action: 'feature_flag.delete',
    summary: `Deleted feature flag "${key}" (${overrideCount} per-org override${overrideCount === 1 ? '' : 's'} orphaned)`,
    metadata: { key, overrideCount },
  })

  return apiSuccess({ deleted: true, key, orphanedOverrides: overrideCount })
})
