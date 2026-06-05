import { render, screen, waitFor } from '@testing-library/react'
import PortalMessagesPage from '@/app/(portal)/portal/messages/page'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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
  default: () => <div data-testid="unified-chat" />,
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
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
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
})
