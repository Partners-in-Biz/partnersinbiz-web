import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import type { CommunicationChannel, Conversation, ConversationMessage } from '@/lib/communications/types'
import {
  listConversations,
  listConversationMessages,
  getConversation,
} from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

const COMMUNICATIONS_LIVE_REFRESH_MS = 1500
const COMMUNICATIONS_LIVE_STREAM_TTL_MS = 55_000

const KNOWN_CHANNELS = new Set(['whatsapp', 'sms', 'email', 'in_app', 'messenger', 'instagram'])

interface QueryState {
  orgId: string
  status: 'new' | 'open' | 'pending' | 'resolved' | 'snoozed' | null
  channel: CommunicationChannel | null
  assignee: 'unassigned' | 'mine' | string | null
  campaignId: string | null
  queueId: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent' | null
  label: string | null
  limit: number
  conversationId: string | null
}

type LiveSnapshot = {
  type: 'snapshot'
  conversations: Conversation[]
  conversation: Conversation | null
  messages: ConversationMessage[]
  filter: Pick<QueryState, 'orgId' | 'status' | 'channel' | 'limit' | 'conversationId'>
  emittedAtMs: number
}

function parseQuery(raw: string, user: ApiUser): QueryState {
  const url = new URL(raw)
  const parseInteger = (value: string | null): number => {
    const parsed = Number(value ?? 100)
    if (!Number.isFinite(parsed)) return 100
    return Math.max(1, Math.min(500, Math.floor(parsed)))
  }
  const parseStatus = (value: string | null): QueryState['status'] => {
    if (value === 'new'
      || value === 'open'
      || value === 'pending'
      || value === 'resolved'
      || value === 'snoozed') return value
    return null
  }
  const parseChannel = (value: string | null): QueryState['channel'] => {
    if (!value) return null
    return KNOWN_CHANNELS.has(value) ? (value as CommunicationChannel) : null
  }
  const parsePriority = (value: string | null): QueryState['priority'] => {
    if (value === 'low' || value === 'normal' || value === 'high' || value === 'urgent') return value
    return null
  }
  const parseConversationId = (value: string | null): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    return trimmed || null
  }

  return {
    orgId: url.searchParams.get('orgId')?.trim() || user.orgId || user.activeOrgId || '',
    status: parseStatus(url.searchParams.get('status')),
    channel: parseChannel(url.searchParams.get('channel')),
    assignee: ['unassigned', 'mine'].includes(url.searchParams.get('assignee') || '')
      ? (url.searchParams.get('assignee') as 'unassigned' | 'mine')
      : url.searchParams.get('assignee')?.trim() || null,
    campaignId: url.searchParams.get('campaignId')?.trim() || null,
    queueId: url.searchParams.get('queueId')?.trim() || null,
    priority: parsePriority(url.searchParams.get('priority')),
    label: url.searchParams.get('label')?.trim() || null,
    limit: parseInteger(url.searchParams.get('limit')),
    conversationId: parseConversationId(url.searchParams.get('conversationId')),
  }
}

function encodeCommunicationsLiveEvent(snapshot: LiveSnapshot): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
}

function encodeErrorEvent(message: string): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
}

function encoderForRetry(): Uint8Array {
  return new TextEncoder().encode('retry: 2000\n\n')
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const query = parseQuery(req.url, user)
  const orgScope = resolveOrgScope(user, query.orgId || null)
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  if (user.role === 'ai' && (!user.orgId || user.orgId !== orgScope.orgId)) {
    return apiError('AI credentials are not authorised for this organisation', 403)
  }

  const loadSnapshot = async (): Promise<LiveSnapshot> => {
    const conversationResult = await listConversations(orgScope.orgId, {
      status: query.status,
      channel: query.channel,
      assignee: query.assignee,
      campaignId: query.campaignId,
      queueId: query.queueId,
      priority: query.priority,
      label: query.label,
      limit: query.limit,
    })
    const conversations = conversationResult.items

    let conversation = null
    if (query.conversationId) {
      const found = conversations.find((item) => item.id === query.conversationId) ?? null
      if (found) {
        conversation = found
      } else {
        const remote = await getConversation(orgScope.orgId, query.conversationId)
        conversation = remote
      }
    }

    const messages = conversation ? await listConversationMessages(orgScope.orgId, conversation.id) : []

    return {
      type: 'snapshot',
      conversations,
      conversation,
      messages,
      filter: {
        orgId: orgScope.orgId,
        status: query.status,
        channel: query.channel,
        limit: query.limit,
        conversationId: query.conversationId,
      },
      emittedAtMs: Date.now(),
    }
  }

  const initialSnapshot = await loadSnapshot()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let interval: ReturnType<typeof setInterval> | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null
      let isBusy = false

      const close = () => {
        if (closed) return
        closed = true
        if (interval) clearInterval(interval)
        if (timeout) clearTimeout(timeout)
        req.signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch {
          // Reader may already be closed.
        }
      }
      cleanup = close

      const emitLatest = async () => {
        if (closed || isBusy) return
        isBusy = true
        try {
          const snapshot = await loadSnapshot()
          if (closed) return
          controller.enqueue(encodeCommunicationsLiveEvent(snapshot))
        } catch (error) {
          if (closed) return
          controller.enqueue(encodeErrorEvent(error instanceof Error ? error.message : 'Failed to refresh communications live stream'))
          close()
        } finally {
          isBusy = false
        }
      }

      controller.enqueue(encoderForRetry())
      controller.enqueue(encodeCommunicationsLiveEvent(initialSnapshot))
      req.signal.addEventListener('abort', close, { once: true })
      interval = setInterval(() => {
        void emitLatest()
      }, COMMUNICATIONS_LIVE_REFRESH_MS)
      timeout = setTimeout(close, COMMUNICATIONS_LIVE_STREAM_TTL_MS)
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
