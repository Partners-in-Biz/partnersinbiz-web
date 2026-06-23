import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { runOnPageCheck } from '@/lib/seo/onpage-check'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  if (!body?.url || !body?.keyword) return apiError('url and keyword are required', 400)
  const result = await runOnPageCheck(body.url, body.keyword)
  return apiSuccess(result)
})
