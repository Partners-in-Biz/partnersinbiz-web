import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess } from '@/lib/api/response'
import { runExecutionLoopForSprint } from '@/lib/seo/loops/execution'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function wantsHtml(req: NextRequest) {
  return req.headers.get('accept')?.includes('text/html') ?? false
}

function sprintRunRedirect(req: NextRequest, sprintId: string) {
  const fallback = new URL(`/admin/seo/sprints/${sprintId}`, req.nextUrl.origin)
  const referer = req.headers.get('referer')
  let target = fallback

  if (referer) {
    try {
      const refererUrl = new URL(referer)
      if (refererUrl.origin === req.nextUrl.origin && refererUrl.pathname.startsWith(`/admin/seo/sprints/${sprintId}`)) {
        target = refererUrl
      }
    } catch {
      target = fallback
    }
  }

  target.searchParams.set('seoRun', 'done')
  return NextResponse.redirect(target, 303)
}

export const POST = withAuth(
  'admin',
  withIdempotency(async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const result = await runExecutionLoopForSprint(id, user)

    if (wantsHtml(req)) {
      return sprintRunRedirect(req, id)
    }

    return apiSuccess(result)
  }),
)
