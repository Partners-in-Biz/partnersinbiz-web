// app/api/v1/ads/insights/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  const url = new URL(req.url)
  const level = url.searchParams.get('level')
  const dimensionId = url.searchParams.get('dimensionId')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const metric = url.searchParams.get('metric')
  const platform = url.searchParams.get('platform') // optional: meta | google | linkedin

  // Map ?platform=<x> to source filter; default to meta_ads for backward-compat
  const platformSourceMap: Record<string, string> = {
    meta: 'meta_ads',
    google: 'google_ads',
    linkedin: 'linkedin_ads',
  }
  const source = platform && platformSourceMap[platform] ? platformSourceMap[platform] : 'meta_ads'

  let q = adminDb.collection('metrics').where('orgId', '==', orgId).where('source', '==', source)
  if (level) q = q.where('level', '==', level)
  if (dimensionId) q = q.where('dimensionId', '==', dimensionId)
  if (metric) q = q.where('metric', '==', metric)
  if (since) q = q.where('date', '>=', since)
  if (until) q = q.where('date', '<=', until)

  const snap = await q.get()
  const rows = snap.docs.map((d) => d.data())
  return apiSuccess(rows)
})
