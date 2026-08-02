import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import {
  authorizeConversationProject,
  canAccessConversation,
  publicConversationMessageView,
  publicConversationView,
} from '@/lib/conversations/access'
import {
  getConversation,
  listConversations,
  listMessages,
} from '@/lib/conversations/conversations'
import {
  listConversationPresence,
} from '@/lib/conversations/presence'
import {
  CONVERSATION_LIVE_REFRESH_MS,
  CONVERSATION_LIVE_MESSAGE_LIMIT,
  CONVERSATION_LIVE_STREAM_TTL_MS,
  conversationLiveSnapshotSignature,
  encodeConversationLiveEvent,
  parseConversationLiveQuery,
  type ConversationLiveSnapshot,
} from '@/lib/conversations/live-feed'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const query = parseConversationLiveQuery(req.url)
  const orgScope = resolveOrgScope(user, query.orgId)
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  if (user.role === 'ai' && (!user.orgId || user.orgId !== orgScope.orgId)) {
    return apiError('AI credentials are not authorised for this organisation', 403)
  }

  const loadSnapshot = async (): Promise<ConversationLiveSnapshot> => {
    const conversations = await listConversations(orgScope.orgId, user, query.limit, {
      scope: query.scope,
      scopeRefId: query.scopeRefId,
      projectId: query.projectId,
      includeAllScopes: query.includeAllScopes,
    })

  let activeConversation = query.conversationId
      ? conversations.find((conversation) => conversation.id === query.conversationId) ?? null
      : null

    // A saved/focused chat can intentionally sit outside the current rail
    // filter. Resolve it independently, but only through the same access and
    // mutable project-link checks as the canonical conversation endpoints.
    if (query.conversationId && !activeConversation) {
      const candidate = await getConversation(query.conversationId)
      if (candidate && candidate.orgId === orgScope.orgId && canAccessConversation(user, candidate)) {
        const projectAccess = await authorizeConversationProject(user, candidate)
        if (projectAccess.ok) activeConversation = candidate
      }
    }

    const messages = activeConversation
      ? (await listMessages(activeConversation.id, CONVERSATION_LIVE_MESSAGE_LIMIT)).map(publicConversationMessageView)
      : null
    const presence = activeConversation
      ? await listConversationPresence(activeConversation.id, orgScope.orgId)
      : null

    return {
      type: 'snapshot',
      conversations: conversations.map((conversation) => publicConversationView(conversation, user.uid)),
      conversation: activeConversation ? publicConversationView(activeConversation, user.uid) : null,
      messages,
      presence,
      emittedAtMs: Date.now(),
    }
  }

  // Resolve once before returning a stream so permission/index failures remain
  // ordinary HTTP errors rather than opaque EventSource disconnects.
  const initialSnapshot = await loadSnapshot()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let busy = false
      let interval: ReturnType<typeof setInterval> | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null
      let lastSignature = conversationLiveSnapshotSignature(initialSnapshot)

      const close = () => {
        if (closed) return
        closed = true
        if (interval) clearInterval(interval)
        if (timeout) clearTimeout(timeout)
        req.signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch (error) {
          void error
          // The reader may already have closed the stream.
        }
      }
      cleanup = close

      const emitLatest = async () => {
        if (closed || busy) return
        busy = true
        try {
          const snapshot = await loadSnapshot()
          if (closed) return
          const signature = conversationLiveSnapshotSignature(snapshot)
          if (signature === lastSignature) return
          lastSignature = signature
          controller.enqueue(encodeConversationLiveEvent(snapshot))
        } catch (error) {
          if (closed) return
          controller.enqueue(encodeConversationLiveEvent({
            type: 'error',
            error: error instanceof Error ? error.message : 'Live conversation refresh failed',
          }))
          close()
        } finally {
          busy = false
        }
      }

      controller.enqueue(new TextEncoder().encode('retry: 1500\n\n'))
      controller.enqueue(encodeConversationLiveEvent(initialSnapshot))
      req.signal.addEventListener('abort', close, { once: true })
      interval = setInterval(() => {
        void emitLatest()
      }, CONVERSATION_LIVE_REFRESH_MS)
      timeout = setTimeout(close, CONVERSATION_LIVE_STREAM_TTL_MS)
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
