import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import UnifiedChat from '@/components/chat/UnifiedChat'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const conversationA = {
  id: 'conv-a',
  orgId: 'org-1',
  participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
  participantUids: ['user-1'],
  participantAgentIds: ['pip'],
  startedBy: 'user-1',
  title: 'Session A',
  messageCount: 1,
  archived: false,
  contextRefs: [],
}

const conversationB = {
  ...conversationA,
  id: 'conv-b',
  title: 'Session B',
}

const messageA = {
  id: 'msg-a',
  conversationId: 'conv-a',
  role: 'assistant',
  content: 'Reply belonging to session A',
  authorKind: 'agent',
  authorId: 'pip',
  authorDisplayName: 'Pip',
  status: 'completed',
  createdAt: '2026-07-23T10:00:00.000Z',
}

const messageB = {
  id: 'msg-b',
  conversationId: 'conv-b',
  role: 'assistant',
  content: 'Reply belonging to session B',
  authorKind: 'agent',
  authorId: 'pip',
  authorDisplayName: 'Pip',
  status: 'completed',
  createdAt: '2026-07-23T10:01:00.000Z',
}

function ControlledChat({
  initialId,
  onReady,
}: {
  initialId: string
  onReady: (setActiveId: (id: string) => void) => void
}) {
  const [activeId, setActiveId] = useState(initialId)
  useEffect(() => {
    onReady(setActiveId)
  }, [onReady])
  return (
    <UnifiedChat
      orgId="org-1"
      currentUserUid="user-1"
      currentUserDisplayName="Peet"
      activeConversationId={activeId}
      onActiveConversationChange={setActiveId}
    />
  )
}

describe('UnifiedChat session race', () => {
  it('does not paint a late message load from a previous session into the active session', async () => {
    let resolveA: ((value: Response) => void) | null = null
    const delayedA = new Promise<Response>((resolve) => {
      resolveA = resolve
    })

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?') || url.includes('/visible-agents') || url.includes('/contacts')) {
        return jsonResponse({ data: url.includes('/models?') ? {
          agentId: 'pip',
          canSelect: false,
          currentModel: null,
          currentProvider: null,
          source: 'hermes',
          providers: [],
          models: [],
        } : [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [], projects: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversationA, conversationB] } })
      }
      if (url === '/api/v1/conversations/conv-a/messages') return delayedA
      if (url === '/api/v1/conversations/conv-b/messages') {
        return jsonResponse({ data: { messages: [messageB] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    let setActiveId: ((id: string) => void) | null = null
    render(
      <ControlledChat
        initialId="conv-a"
        onReady={(setter) => {
          setActiveId = setter
        }}
      />,
    )

    await waitFor(() => expect(setActiveId).not.toBeNull())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/conversations/conv-a/messages')

    await act(async () => {
      setActiveId?.('conv-b')
    })

    await waitFor(() => {
      expect(screen.getByText('Reply belonging to session B')).toBeInTheDocument()
    })

    await act(async () => {
      resolveA?.(jsonResponse({ data: { messages: [messageA] } }))
    })

    // Give the stale load a turn to mis-paint if the race guard is missing.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Reply belonging to session B')).toBeInTheDocument()
    expect(screen.queryByText('Reply belonging to session A')).not.toBeInTheDocument()
  })
})
