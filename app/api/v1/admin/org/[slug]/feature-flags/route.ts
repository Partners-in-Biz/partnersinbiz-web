/**
 * GET / PUT  /api/v1/admin/org/[slug]/feature-flags (US-315)
 *
 * Read and write the org's `featureFlags` record (Record<string, boolean>).
 * GET returns the current flags + the list of known flags (so the UI can render
 * toggles even for flags not yet set) + an override count (flags that differ
 * from the default of false). PUT replaces the whole flag map.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { resolveOrgBySlug } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

/**
 * Known feature flags surfaced in the admin UI. Default is false; any flag set
 * to true (or any non-known key present) is an "override".
 */
export const KNOWN_FEATURE_FLAGS: Array<{ key: string; label: string; description: string }> = [
  { key: 'aiContentEngine', label: 'AI content engine', description: 'Multi-channel AI content production and campaigns.' },
  { key: 'adsManager', label: 'Ads manager', description: 'Paid advertising campaigns across Meta, Google, LinkedIn, TikTok.' },
  { key: 'seoSprints', label: 'SEO sprints', description: '90-day SEO sprint manager and audits.' },
  { key: 'emailOutreach', label: 'Email & SMS outreach', description: 'Sequences, broadcasts, drip campaigns.' },
  { key: 'analyticsPro', label: 'Analytics pro', description: 'Advanced product analytics, funnels, cohorts.' },
  { key: 'agentAccess', label: 'Agent access', description: 'Hermes AI agent access for this workspace.' },
  { key: 'whatsappChannel', label: 'WhatsApp channel', description: 'WhatsApp omnichannel messaging.' },
  { key: 'betaFeatures', label: 'Beta features', description: 'Opt this org into early-access beta surfaces.' },
]

function overrideCount(flags: Record<string, boolean>): number {
  return Object.values(flags).filter((v) => v === true).length
}

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)

  const flags = resolved.data.featureFlags ?? {}
  return apiSuccess({
    flags,
    knownFlags: KNOWN_FEATURE_FLAGS,
    overrideCount: overrideCount(flags),
  })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const body = await req.json().catch(() => ({}))
  const incoming = body?.flags
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return apiError('flags must be an object of { key: boolean }', 400)
  }

  // Sanitise to a clean Record<string, boolean>.
  const flags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    const cleanKey = key.trim()
    if (!cleanKey) continue
    flags[cleanKey] = value === true
  }

  const before = org.featureFlags ?? {}
  const changed: string[] = []
  const allKeys = new Set([...Object.keys(before), ...Object.keys(flags)])
  for (const key of allKeys) {
    if ((before[key] === true) !== (flags[key] === true)) changed.push(key)
  }

  await adminDb.collection('organizations').doc(id).update({
    featureFlags: flags,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAdminAudit(user, {
    action: 'org.feature_flags',
    orgId: id,
    summary: `Updated ${changed.length} feature flag(s) for "${org.name ?? slug}"`,
    metadata: { slug, changed, before, after: flags },
  })

  return apiSuccess({ flags, overrideCount: overrideCount(flags), changed })
})
