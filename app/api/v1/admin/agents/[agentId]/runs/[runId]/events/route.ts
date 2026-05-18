/**
 * GET /api/v1/admin/agents/[agentId]/runs/[runId]/events
 *
 * Proxies the SSE event stream from the agent's own gateway to the browser.
 * Used by the chat UI to display live tool-call events while a run is in progress.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { callAgentStream } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; runId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId, runId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  try {
    const upstream = await callAgentStream(agentId as AgentId, `/v1/runs/${encodeURIComponent(runId)}/events`)
    if (!upstream.ok || !upstream.body) {
      return apiError(`Agent gateway returned ${upstream.status}`, 502)
    }

    const reader = upstream.body.getReader()
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) { controller.close(); return }
          controller.enqueue(value)
        } catch (err) {
          controller.error(err)
        }
      },
      cancel() { reader.cancel() },
    })

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
