import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { requireHermesProfileAccess, callHermesStream } from '@/lib/hermes/server'
import { apiError } from '@/lib/api/response'
import { createNormalizedHermesSseStream } from '@/lib/hermes/progress-events'

type RouteContext = { params: Promise<{ orgId: string; runId: string }> }

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { orgId, runId } = await (ctx as RouteContext).params

  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const { link } = access

  try {
    const hermesRes = await callHermesStream(link, `/v1/runs/${encodeURIComponent(runId)}/events`)
    if (!hermesRes.ok || !hermesRes.body) {
      return apiError(`Hermes stream returned ${hermesRes.status}`, 502)
    }

    const stream = createNormalizedHermesSseStream(hermesRes.body, { runId })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Stream failed', 502)
  }
})
