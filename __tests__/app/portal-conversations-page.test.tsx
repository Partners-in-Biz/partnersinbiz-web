import { render, screen, waitFor } from '@testing-library/react'
import ConversationsPage from '@/app/(portal)/portal/conversations/page'

const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string; email: string; displayName: string }) => void) => {
    cb({ uid: 'user-1', email: 'peet@example.com', displayName: 'Peet' })
    return jest.fn()
  },
}))

jest.mock('@/lib/firebase/config', () => ({
  auth: {},
  getClientAuth: () => ({ authStateReady: () => Promise.resolve() }),
}))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: ({
    initialConvId,
    orgId,
    orgName,
    allowStartConversations,
    allowSendMessages,
    allowAgentParticipants,
    allowArchiveConversations,
  }: {
    initialConvId?: string
    orgId: string
    orgName?: string
    allowStartConversations?: boolean
    allowSendMessages?: boolean
    allowAgentParticipants?: boolean
    allowArchiveConversations?: boolean
  }) => (
    <div
      data-testid="unified-chat"
      data-conv-id={initialConvId ?? ''}
      data-org-id={orgId}
      data-allow-start={String(allowStartConversations)}
      data-allow-send={String(allowSendMessages)}
      data-allow-agent={String(allowAgentParticipants)}
      data-allow-archive={String(allowArchiveConversations)}
    >
      {orgName}
    </div>
  ),
}))

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

describe('ConversationsPage', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockSearchParams = new URLSearchParams()
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return jsonResponse({
          org: {
            id: 'lumen-org',
            name: 'Lumen',
            modulePolicies: {
              messages: {
                actions: {
                  start: { owner: true, admin: true, member: false },
                  reply: { owner: true, admin: true, member: false },
                  agentHandoff: { owner: true, admin: true, member: false },
                  archive: { owner: true, admin: true, member: false },
                },
              },
            },
          },
          user: { uid: 'user-1', name: 'Peet', email: 'peet@example.com', role: 'client', memberRole: 'member' },
        })
      }
      if (url === '/api/v1/portal/org') {
        return jsonResponse({
          org: { id: 'org-1', name: 'Acme' },
          user: { uid: 'user-1', name: 'Peet', email: 'peet@example.com', role: 'client' },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('keeps conversations scoped to the active CRM company workspace', async () => {
    mockSearchParams = new URLSearchParams({
      convId: 'conv-1',
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(<ConversationsPage />)

    const chat = await screen.findByTestId('unified-chat')

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org?orgId=lumen-org')
    })
    expect(chat).toHaveAttribute('data-org-id', 'lumen-org')
    expect(chat).toHaveAttribute('data-conv-id', 'conv-1')
    expect(chat).toHaveAttribute('data-allow-start', 'false')
    expect(chat).toHaveAttribute('data-allow-send', 'false')
    expect(chat).toHaveAttribute('data-allow-agent', 'false')
    expect(chat).toHaveAttribute('data-allow-archive', 'false')
    expect(screen.getByText('Lumen workspace')).toBeInTheDocument()
  })

  it('frames conversations as a team command center', async () => {
    render(<ConversationsPage />)

    expect(await screen.findByRole('heading', { name: 'Conversation command center' })).toBeInTheDocument()
    expect(screen.getByText('Client thread')).toBeInTheDocument()
    expect(screen.getByText('Team handoff')).toBeInTheDocument()
  })
})
