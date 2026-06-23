import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { runPerformance } from '@/lib/seo/performance'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  // Support multi-URL mode: urls?: string[] OR url?: string
  const urlsRaw: string[] = body?.urls
    ? (Array.isArray(body.urls) ? body.urls : [body.urls])
    : body?.url
    ? [body.url]
    : []
  if (urlsRaw.length === 0) return apiError('url or urls is required', 400)
  if (urlsRaw.length > 3) return apiError('Maximum 3 URLs per request', 400)

  const strategy: 'mobile' | 'desktop' = body?.strategy === 'desktop' ? 'desktop' : 'mobile'
  const sprintId: string | undefined = body?.sprintId
  const orgId = user.orgId ?? (user.role === 'ai' ? body?.orgId : undefined)

  // If sprintId provided, verify org
  if (sprintId) {
    const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
    if (!sprintSnap.exists) return apiError('Sprint not found', 404)
    const sprint = sprintSnap.data() as any
    if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Access denied', 403)
  }

  // Run sequentially (avoid rate-limiting PageSpeed API)
  const results = []
  for (const url of urlsRaw) {
    try {
      const r = await runPerformance(url, strategy)
      results.push(r)

      // Persist to seo_performance_runs
      if (orgId) {
        await adminDb.collection('seo_performance_runs').add({
          orgId,
          sprintId: sprintId ?? null,
          url: r.url,
          strategy: r.strategy,
          lcp: r.lcp ?? null,
          cls: r.cls ?? null,
          inp: r.inp ?? null,
          ttfb: r.ttfb ?? null,
          score: r.score,
          ranAt: new Date().toISOString(),
          deleted: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    } catch (err) {
      results.push({ url, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Single URL returns object, multi returns array
  return apiSuccess(results.length === 1 ? results[0] : results)
})
