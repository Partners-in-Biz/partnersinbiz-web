import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { fetchInboundLinks } from '@/lib/seo/integrations/bing'
import { findInboundLinks as ccLinks } from '@/lib/seo/integrations/commoncrawl'
import { getPageRank } from '@/lib/seo/integrations/openpagerank'
import type { ApiUser } from '@/lib/api/types'

function ignoreBestEffortFailure() {
  return undefined
}

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const snap = await adminDb.collection('seo_sprints').doc(id).get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprint = snap.data() as any
    if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Access denied', 403)

    const candidates: Array<{ source: string; domain: string; theirDR?: number; via: string }> = []
    let domain = sprint.siteUrl
    try {
      domain = new URL(sprint.siteUrl).hostname
    } catch { ignoreBestEffortFailure() }

    if (sprint.integrations?.bing?.connected && sprint.integrations.bing.siteUrl) {
      try {
        const links = await fetchInboundLinks(sprint.integrations.bing.siteUrl)
        for (const l of links.slice(0, 50)) {
          let host = l.sourceUrl
          try {
            host = new URL(l.sourceUrl).hostname
          } catch { ignoreBestEffortFailure() }
          candidates.push({ source: l.sourceUrl, domain: host, via: 'bing-wmt' })
        }
      } catch { ignoreBestEffortFailure() }
    }

    try {
      const ccUrls = await ccLinks(domain, 50)
      for (const u of ccUrls) {
        let host = u
        try {
          host = new URL(u).hostname
        } catch {
          continue
        }
        candidates.push({ source: u, domain: host, via: 'common-crawl' })
      }
    } catch { ignoreBestEffortFailure() }

    // Try to enrich with DR
    if (process.env.OPR_API_KEY && candidates.length > 0) {
      const uniqueDomains = [...new Set(candidates.map((c) => c.domain))].slice(0, 100)
      try {
        const ranks = await getPageRank(uniqueDomains)
        for (const c of candidates) c.theirDR = ranks[c.domain]
      } catch { ignoreBestEffortFailure() }
    }

    return apiSuccess({ candidates, count: candidates.length })
  },
)
