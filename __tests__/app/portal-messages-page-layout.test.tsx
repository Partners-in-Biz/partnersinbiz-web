import { render, screen, waitFor } from '@testing-library/react'
import PortalMessagesPage from '@/app/(portal)/portal/messages/page'

const mockPush = jest.fn()
const mockRouter = { push: mockPush }
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
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
    orgId,
    orgName,
    allowStartConversations,
    allowSendMessages,
    allowAgentParticipants,
    allowArchiveConversations,
  }: {
    orgId: string
    orgName?: string
    allowStartConversations?: boolean
    allowSendMessages?: boolean
    allowAgentParticipants?: boolean
    allowArchiveConversations?: boolean
  }) => (
    <div
      data-testid="unified-chat"
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

describe('Portal messages page layout', () => {
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

  it('bounds the chat to the viewport and fades the intro chrome away', async () => {
    render(<PortalMessagesPage />)

    const chat = await screen.findByTestId('unified-chat')
    const workspace = chat.closest('[data-testid="portal-messages-workspace"]')
    const intro = screen.getByTestId('portal-messages-intro')

    expect(workspace).toHaveClass('overflow-hidden')
    expect(workspace).toHaveClass('h-[calc(100dvh-120px)]')
    expect(intro).toHaveClass('max-h-28')
    expect(intro).toHaveClass('opacity-100')

    await waitFor(() => {
      expect(intro).toHaveClass('max-h-0')
      expect(intro).toHaveClass('opacity-0')
    }, { timeout: 4000 })
  }, 8000)

  it('keeps portal messages scoped to the CRM company workspace organisation', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(<PortalMessagesPage />)

    const chat = await screen.findByTestId('unified-chat')

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org?orgId=lumen-org')
    })
    expect(chat).toHaveAttribute('data-org-id', 'lumen-org')
    expect(chat).toHaveAttribute('data-allow-start', 'false')
    expect(chat).toHaveAttribute('data-allow-send', 'false')
    expect(chat).toHaveAttribute('data-allow-agent', 'false')
    expect(chat).toHaveAttribute('data-allow-archive', 'false')
    expect(screen.getByText('Lumen')).toBeInTheDocument()
  })
})
