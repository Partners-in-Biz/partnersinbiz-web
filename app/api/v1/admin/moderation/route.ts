/**
 * GET /api/v1/admin/moderation
 *
 * Real content-moderation queue. Returns flagged content (pending social posts
 * + review-state campaigns) merged into a single review list, the per-org
 * 3-strike warning log, and the most recent moderation decisions.
 *
 * Queries are read with a bound limit and statuses are filtered in memory to
 * avoid requiring composite Firestore indexes. Auth: admin.
 */

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const SOCIAL_REVIEW_STATUSES = new Set([
  'pending_approval',
  'client_review',
  'qa_review',
  'in_review',
  'review',
])
const CAMPAIGN_REVIEW_STATUSES = new Set(['pending_approval', 'in_review', 'review'])

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** Normalise Firestore timestamps / strings to an ISO string (or null). */
function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof v.toDate === 'function') {
      try {
        return v.toDate().toISOString()
      } catch {
        return null
      }
    }
    const seconds = v._seconds ?? v.seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return null
}

function previewFrom(doc: Record<string, unknown>): string {
  const raw =
    asString(doc.content) ||
    asString(doc.caption) ||
    asString(doc.body) ||
    asString(doc.text) ||
    asString(doc.name) ||
    asString(doc.title) ||
    ''
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat
}

function platformOf(doc: Record<string, unknown>): string {
  if (Array.isArray(doc.platforms) && doc.platforms.length > 0) {
    return doc.platforms.map((p) => asString(p)).filter(Boolean).join(', ')
  }
  return asString(doc.platform, 'mixed')
}

export const GET = withAuth('admin', async () => {
  try {
    const [orgsSnap, postsSnap, campaignsSnap, strikesSnap, decisionsSnap] = await Promise.all([
      adminDb.collection('organizations').limit(300).get(),
      adminDb.collection('social_posts').limit(200).get(),
      adminDb.collection('campaigns').limit(160).get(),
      adminDb.collection('moderation_strikes').limit(300).get(),
      adminDb.collection('moderation_decisions').limit(120).get(),
    ])

    const orgNames = new Map<string, string>()
    orgsSnap.forEach((d) => {
      const data = d.data() as Record<string, unknown>
      orgNames.set(d.id, asString(data.name, d.id))
    })

    type Item = {
      contentId: string
      contentType: 'social_post' | 'campaign'
      orgId: string
      orgName: string
      status: string
      platform: string
      preview: string
      confidence: number | null
      updatedAt: string | null
      createdAt: string | null
    }

    const items: Item[] = []

    postsSnap.forEach((d) => {
      const data = d.data() as Record<string, unknown>
      const status = asString(data.status)
      if (!SOCIAL_REVIEW_STATUSES.has(status)) return
      const orgId = asString(data.orgId)
      items.push({
        contentId: d.id,
        contentType: 'social_post',
        orgId,
        orgName: orgNames.get(orgId) ?? orgId ?? 'Unknown org',
        status,
        platform: platformOf(data),
        preview: previewFrom(data),
        confidence: asNumberOrNull(data.aiConfidence) ?? asNumberOrNull(data.moderationConfidence),
        updatedAt: tsToIso(data.updatedAt) ?? tsToIso(data.createdAt),
        createdAt: tsToIso(data.createdAt),
      })
    })

    campaignsSnap.forEach((d) => {
      const data = d.data() as Record<string, unknown>
      const status = asString(data.status)
      if (!CAMPAIGN_REVIEW_STATUSES.has(status)) return
      const orgId = asString(data.orgId)
      items.push({
        contentId: d.id,
        contentType: 'campaign',
        orgId,
        orgName: orgNames.get(orgId) ?? orgId ?? 'Unknown org',
        status,
        platform: asString(data.clientType, 'campaign'),
        preview: previewFrom(data),
        confidence: asNumberOrNull(data.aiConfidence) ?? asNumberOrNull(data.moderationConfidence),
        updatedAt: tsToIso(data.updatedAt) ?? tsToIso(data.createdAt),
        createdAt: tsToIso(data.createdAt),
      })
    })

    items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

    const strikes = strikesSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>
      const orgId = asString(data.orgId, d.id)
      const warnings = Array.isArray(data.warnings)
        ? (data.warnings as Array<Record<string, unknown>>).map((w) => ({
            reason: asString(w.reason),
            contentId: asString(w.contentId),
            at: tsToIso(w.at),
          }))
        : []
      return {
        orgId,
        orgName: orgNames.get(orgId) ?? orgId,
        strikes: asNumberOrNull(data.strikes) ?? 0,
        suspended: data.suspended === true,
        suspendedAt: tsToIso(data.suspendedAt),
        warnings: warnings.slice(-5).reverse(),
      }
    })
    strikes.sort((a, b) => b.strikes - a.strikes)

    const decisions = decisionsSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>
        const orgId = asString(data.orgId)
        return {
          id: d.id,
          contentId: asString(data.contentId),
          contentType: asString(data.contentType, 'social_post'),
          orgId,
          orgName: orgNames.get(orgId) ?? orgId,
          decision: asString(data.decision),
          reason: asString(data.reason),
          confidence: asNumberOrNull(data.confidence),
          decidedBy: asString(data.decidedBy),
          decidedAt: tsToIso(data.decidedAt),
        }
      })
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
      .slice(0, 60)

    return apiSuccess({ items, strikes, decisions })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load moderation queue', 500)
  }
})
