/**
 * GET /api/v1/admin/system/storage   (admin)
 *
 * Storage usage aggregated from the `uploads` collection (the canonical,
 * org-tagged, size-bearing file metadata collection). Also folds in the
 * `social_media` collection, which carries `originalSize` (number bytes) +
 * `orgId`. Both are read as a single-field capped slice and aggregated in
 * memory to avoid composite-index requirements.
 *
 * Returns per-org usage, a by-file-type byte breakdown, and any per-org
 * storage limit overrides from `storage_overrides`.
 *
 * Optional query param `plan` filters the returned per-org rows to that plan.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const CAP = 20000

function mimeCategory(mimeType: unknown): string {
  if (typeof mimeType !== 'string' || !mimeType) return 'unknown'
  const top = mimeType.split('/')[0]?.trim().toLowerCase()
  return top || 'unknown'
}

function toNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

interface OrgAgg {
  bytes: number
  files: number
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const planFilter = new URL(req.url).searchParams.get('plan')?.trim() || null

  const byOrgMap = new Map<string, OrgAgg>()
  const byType: Record<string, number> = {}
  let totalBytes = 0
  let totalFiles = 0

  function add(orgIdRaw: unknown, size: number, category: string) {
    const orgId = typeof orgIdRaw === 'string' && orgIdRaw ? orgIdRaw : '(no-org)'
    const agg = byOrgMap.get(orgId) ?? { bytes: 0, files: 0 }
    agg.bytes += size
    agg.files += 1
    byOrgMap.set(orgId, agg)
    byType[category] = (byType[category] ?? 0) + size
    totalBytes += size
    totalFiles += 1
  }

  // --- uploads (primary) ---
  const uploadsSnap = await adminDb.collection('uploads').limit(CAP).get()
  const uploadsCount = uploadsSnap.size
  for (const doc of uploadsSnap.docs) {
    const d = doc.data()
    if (d.deleted === true) continue
    add(d.orgId, toNumber(d.size), mimeCategory(d.mimeType))
  }

  // --- social_media (secondary, originalSize) ---
  const socialSnap = await adminDb.collection('social_media').limit(CAP).get()
  const socialCount = socialSnap.size
  for (const doc of socialSnap.docs) {
    const d = doc.data()
    const size = toNumber(d.originalSize)
    // type field on social_media is 'image' | 'video' | 'gif'; fold into same buckets
    const cat = typeof d.type === 'string' && d.type ? (d.type === 'gif' ? 'image' : d.type) : 'unknown'
    add(d.orgId, size, cat)
  }

  const capped = uploadsCount >= CAP || socialCount >= CAP

  // --- resolve org metadata (batched getAll for distinct real orgIds) ---
  const realOrgIds = Array.from(byOrgMap.keys()).filter((id) => id !== '(no-org)')
  const orgMeta = new Map<string, { name: string; slug: string | null; plan: string | null }>()
  if (realOrgIds.length > 0) {
    const refs = realOrgIds.map((id) => adminDb.collection('organizations').doc(id))
    // getAll handles arbitrary counts in one round-trip
    const orgDocs = await adminDb.getAll(...refs)
    for (const od of orgDocs) {
      if (od.exists) {
        const data = od.data() || {}
        orgMeta.set(od.id, {
          name: typeof data.name === 'string' && data.name ? data.name : od.id,
          slug: typeof data.slug === 'string' ? data.slug : null,
          plan: typeof data.plan === 'string' ? data.plan : null,
        })
      }
    }
  }

  // --- storage_overrides ---
  const overrideMap = new Map<string, number | null>()
  try {
    const ovSnap = await adminDb.collection('storage_overrides').limit(5000).get()
    for (const doc of ovSnap.docs) {
      const d = doc.data()
      const limit = typeof d.limitBytes === 'number' && Number.isFinite(d.limitBytes) ? d.limitBytes : null
      overrideMap.set(doc.id, limit)
    }
  } catch {
    // collection may not exist yet — ignore
  }

  // --- build per-org rows ---
  let byOrg = Array.from(byOrgMap.entries()).map(([orgId, agg]) => {
    const meta = orgMeta.get(orgId)
    return {
      orgId,
      name: meta?.name ?? orgId,
      slug: meta?.slug ?? null,
      plan: meta?.plan ?? null,
      bytes: agg.bytes,
      files: agg.files,
      limitBytes: overrideMap.has(orgId) ? overrideMap.get(orgId)! : null,
    }
  })

  byOrg.sort((a, b) => b.bytes - a.bytes)

  // distinct plan values present (before plan filtering)
  const plans = Array.from(
    new Set(byOrg.map((r) => r.plan).filter((p): p is string => typeof p === 'string' && p.length > 0)),
  ).sort()

  if (planFilter) {
    byOrg = byOrg.filter((r) => r.plan === planFilter)
  }

  return apiSuccess({
    totalBytes,
    totalFiles,
    byType,
    byOrg,
    cap: CAP,
    capped,
    plans,
    sources: {
      uploads: { count: uploadsCount, primary: true },
      social_media: { count: socialCount, sizeField: 'originalSize' },
    },
  })
})
