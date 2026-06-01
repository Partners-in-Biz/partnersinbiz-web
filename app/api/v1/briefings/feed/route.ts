import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { buildBriefingFeed } from '@/lib/briefing/feed'
import type { BriefingPriority, BriefingSourceType } from '@/lib/briefing/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  try {
    const { searchParams } = new URL(req.url)
    const feed = await buildBriefingFeed(user, {
      orgId: searchParams.get('orgId'),
      priority: (searchParams.get('priority') || 'all') as BriefingPriority | 'all',
      sourceType: (searchParams.get('sourceType') || 'all') as BriefingSourceType | 'all',
      limit: Number(searchParams.get('limit') || 40),
    })
    return apiSuccess(feed)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
