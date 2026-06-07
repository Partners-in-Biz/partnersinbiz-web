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
import { createNormalizedHermesSseStream } from '@/lib/hermes/progress-events'

const encoder = new TextEncoder()

function singleEventStream(event: Record<string, unknown>) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      controller.close()
    },
  })
}

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; runId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId, runId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  try {
    const upstream = await callAgentStream(agentId as AgentId, `/v1/runs/${encodeURIComponent(runId)}/events`)
    if (!upstream.ok || !upstream.body) {
      return sseResponse(singleEventStream({
        event: 'stream.unavailable',
        runId,
        run_id: runId,
        timestamp: Date.now() / 1000,
        error: `Agent gateway returned ${upstream.status}`,
        activity: 'Live event stream unavailable; final response polling will continue.',
      }))
    }

    const stream = createNormalizedHermesSseStream(upstream.body, { runId })
    return sseResponse(stream)
  } catch (err) {
    return sseResponse(singleEventStream({
      event: 'stream.unavailable',
      runId,
      run_id: runId,
      timestamp: Date.now() / 1000,
      error: err instanceof Error ? err.message : 'Stream failed',
      activity: 'Live event stream unavailable; final response polling will continue.',
    }))
  }
})
