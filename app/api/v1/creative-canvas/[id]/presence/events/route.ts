import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvas } from '@/lib/creative-canvas/store'
import { listCreativeCanvasPresence } from '@/lib/creative-canvas/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function encodeSseEvent(event: string, data: unknown): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let interval: ReturnType<typeof setInterval> | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null

      const close = () => {
        if (closed) return
        closed = true
        if (interval) clearInterval(interval)
        if (timeout) clearTimeout(timeout)
        try {
          controller.close()
        } catch {
          // The runtime may already have closed the stream when a reader cancels.
        }
      }
      cleanup = close

      const emitSnapshot = async () => {
        if (closed) return
        try {
          const [canvas, presence] = await Promise.all([
            getCreativeCanvas(id, orgId),
            listCreativeCanvasPresence(id, orgId),
          ])
          if (closed) return
          controller.enqueue(encodeSseEvent('collaboration', {
            canvas,
            presence,
            mutations: presence
              .map((item) => ({
                actorUid: item.actorUid,
                actorType: item.actorType,
                operation: item.latestMutation?.operation,
                touchedNodeIds: item.latestMutation?.touchedNodeIds ?? [],
                touchedEdgeIds: item.latestMutation?.touchedEdgeIds ?? [],
                source: 'stream',
                occurredAt: item.latestMutation?.occurredAt,
              }))
              .filter((item) => item.operation && item.occurredAt),
            emittedAtMs: Date.now(),
          }))
        } catch (error) {
          if (closed) return
          controller.enqueue(encodeSseEvent('error', {
            error: error instanceof Error ? error.message : 'Creative Canvas collaboration stream failed',
          }))
          close()
        }
      }

      controller.enqueue(new TextEncoder().encode('retry: 2000\n\n'))
      void emitSnapshot()
      interval = setInterval(() => {
        void emitSnapshot()
      }, 2000)
      timeout = setTimeout(close, 55_000)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
