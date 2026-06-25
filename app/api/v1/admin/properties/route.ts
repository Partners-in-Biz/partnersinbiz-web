/**
 * Platform feature-flag control plane.
 *
 * GET  /api/v1/admin/properties
 *   Returns global flag definitions (with per-org override counts), the flat
 *   list of per-org overrides, and recent feature_flag.* audit entries.
 *
 * POST /api/v1/admin/properties
 *   Create or update a global flag definition. Body { key, type, defaultValue,
 *   description }. Upserts into the `platform_feature_flags` collection.
 *
 * Auth: admin. Every mutation is audited.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit, readAdminAudit } from '@/lib/admin/audit'
import {
  FLAGS_COLLECTION,
  KEY_PATTERN,
  coerceValue,
  isFlagType,
  toFlagDef,
  type FlagType,
} from './_shared'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const [flagsSnap, orgsSnap] = await Promise.all([
    adminDb.collection(FLAGS_COLLECTION).get(),
    adminDb.collection('organizations').limit(300).get(),
  ])

  // Build a map of flagKey -> overrides across all orgs, plus the full org roster
  // (id + name) so the UI can offer any org in the "add override" picker.
  const overridesByKey = new Map<string, { orgId: string; orgName: string; value: unknown }[]>()
  const orgs: { id: string; name: string }[] = []
  for (const doc of orgsSnap.docs) {
    const data = doc.data() as Record<string, unknown>
    const orgName = typeof data.name === 'string' ? data.name : doc.id
    orgs.push({ id: doc.id, name: orgName })
    const ff = (data.featureFlags && typeof data.featureFlags === 'object')
      ? (data.featureFlags as Record<string, unknown>)
      : {}
    for (const [flagKey, value] of Object.entries(ff)) {
      if (value === undefined) continue
      const list = overridesByKey.get(flagKey) ?? []
      list.push({ orgId: doc.id, orgName, value })
      overridesByKey.set(flagKey, list)
    }
  }
  orgs.sort((a, b) => a.name.localeCompare(b.name))

  const flags = flagsSnap.docs
    .map((doc) => {
      const def = toFlagDef(doc.id, doc.data() as Record<string, unknown>)
      return { ...def, overrideCount: overridesByKey.get(def.key)?.length ?? 0 }
    })
    .sort((a, b) => a.key.localeCompare(b.key))

  const orgOverrides = Array.from(overridesByKey.entries())
    .flatMap(([flagKey, list]) =>
      list.map((o) => ({ flagKey, orgId: o.orgId, orgName: o.orgName, value: o.value })),
    )
    .sort((a, b) => a.flagKey.localeCompare(b.flagKey) || a.orgName.localeCompare(b.orgName))

  const auditAll = await readAdminAudit({ limit: 200 })
  const audit = auditAll.filter((a) => a.action.startsWith('feature_flag.')).slice(0, 50)

  return apiSuccess({ flags, orgOverrides, orgs, audit })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const key = String(body.key ?? '').trim().toLowerCase()
  if (!KEY_PATTERN.test(key)) {
    return apiError('key must be lowercase, start with a letter, and match ^[a-z][a-z0-9_.-]{1,60}$', 400)
  }

  const type = String(body.type ?? '').trim() as FlagType
  if (!isFlagType(type)) return apiError('type must be one of boolean, string, number', 400)

  const description = String(body.description ?? '').trim()
  let defaultValue: boolean | string | number
  try {
    defaultValue = coerceValue(type, body.defaultValue)
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Invalid defaultValue for type', 400)
  }

  const ref = adminDb.collection(FLAGS_COLLECTION).doc(key)
  const existing = await ref.get()
  const now = FieldValue.serverTimestamp()

  await ref.set(
    {
      key,
      type,
      defaultValue,
      description,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true },
  )

  await writeAdminAudit(user, {
    action: 'feature_flag.upsert',
    summary: `${existing.exists ? 'Updated' : 'Created'} feature flag "${key}" (${type})`,
    metadata: { key, type, defaultValue, description },
  })

  const saved = await ref.get()
  return apiSuccess(toFlagDef(key, saved.data() as Record<string, unknown>), existing.exists ? 200 : 201)
})
