import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { createBriefingSnapshot } from '@/lib/briefing/feed'
import type { BriefingPriority, BriefingSourceType } from '@/lib/briefing/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  try {
    const body = await req.json().catch(() => ({}))
    const snapshot = await createBriefingSnapshot(user, {
      orgId: typeof body.orgId === 'string' ? body.orgId : null,
      title: typeof body.title === 'string' ? body.title : null,
      priority: (typeof body.priority === 'string' ? body.priority : 'all') as BriefingPriority | 'all',
      sourceType: (typeof body.sourceType === 'string' ? body.sourceType : 'all') as BriefingSourceType | 'all',
      limit: typeof body.limit === 'number' ? body.limit : 80,
    })
    return apiSuccess({ snapshot })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
