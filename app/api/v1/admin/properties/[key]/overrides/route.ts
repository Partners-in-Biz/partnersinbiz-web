/**
 * PUT /api/v1/admin/properties/[key]/overrides — set or clear a per-org
 *   override for a flag. Body { orgId, value }. value === null clears the
 *   override (removes the field from the org's featureFlags map); otherwise the
 *   value is coerced to the flag's declared type and stored.
 *
 * Auth: admin. All mutations are audited.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { FLAGS_COLLECTION, coerceValue, isFlagType } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ key: string }> }

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { key } = await (ctx as RouteContext).params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const orgId = String(body.orgId ?? '').trim()
  if (!orgId) return apiError('orgId is required', 400)

  // A restricted admin may only override flags for orgs they are scoped to.
  // Without this, a body-supplied orgId lets them flip feature flags on any org.
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const orgSnap = await orgRef.get()
  if (!orgSnap.exists) return apiError('Organisation not found', 404)

  const clearing = body.value === null
  const fieldPath = `featureFlags.${key}`

  if (clearing) {
    await orgRef.update({ [fieldPath]: FieldValue.delete() })
    await writeAdminAudit(user, {
      action: 'feature_flag.override',
      orgId,
      summary: `Cleared "${key}" override for org ${orgId}`,
      metadata: { key, orgId, value: null, cleared: true },
    })
    return apiSuccess({ orgId, key, value: null })
  }

  // Coerce against the flag's declared type when a definition exists.
  const flagSnap = await adminDb.collection(FLAGS_COLLECTION).doc(key).get()
  const flagType = flagSnap.exists && isFlagType((flagSnap.data() as Record<string, unknown>).type)
    ? ((flagSnap.data() as Record<string, unknown>).type as 'boolean' | 'string' | 'number')
    : 'boolean'

  let value: boolean | string | number
  try {
    value = coerceValue(flagType, body.value)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Invalid override value for flag type', 400)
  }

  await orgRef.set({ featureFlags: { [key]: value } }, { merge: true })

  await writeAdminAudit(user, {
    action: 'feature_flag.override',
    orgId,
    summary: `Set "${key}" override to ${JSON.stringify(value)} for org ${orgId}`,
    metadata: { key, orgId, value },
  })

  return apiSuccess({ orgId, key, value })
})
