import { render, screen, waitFor } from '@testing-library/react'
import { EntityScopedChat } from '@/components/crm/EntityScopedChat'

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string; displayName: string } | null) => void) => {
    callback({ uid: 'user-1', displayName: 'Peet' })
    return () => undefined
  },
}))

jest.mock('@/lib/firebase/config', () => ({
  auth: {},
  getClientAuth: () => ({
    authStateReady: async () => undefined,
  }),
}))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div
      data-testid="unified-chat"
      data-scope={String(props.scope ?? '')}
      data-scope-ref={String(props.scopeRefId ?? '')}
      data-org-name={String(props.orgName ?? '')}
      data-auto-title={String(props.autoCreateTitle ?? '')}
      data-compact={props.compact ? 'true' : 'false'}
      data-include-all-scopes={props.includeAllScopes ? 'true' : 'false'}
    />
  ),
}))

describe('EntityScopedChat company Cowork chrome', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/verify')) {
        return {
          ok: true,
          json: async () => ({ displayName: 'Peet', role: 'admin' }),
        } as Response
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders Company Cowork chrome and locks UnifiedChat to the company folder', async () => {
    render(
      <EntityScopedChat
        orgId="org-1"
        entityType="company"
        entityId="company-hunt"
        entityLabel="Hunt and Gun"
        href="/portal/companies/company-hunt"
      />,
    )

    expect(await screen.findByText('Company Cowork')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hunt and Gun' })).toBeInTheDocument()
    expect(screen.getByText(/Sessions stay on this folder/i)).toBeInTheDocument()

    const chat = await screen.findByTestId('unified-chat')
    await waitFor(() => {
      expect(chat).toHaveAttribute('data-scope', 'company')
      expect(chat).toHaveAttribute('data-scope-ref', 'company-hunt')
      expect(chat).toHaveAttribute('data-org-name', 'Hunt and Gun')
      expect(chat).toHaveAttribute('data-auto-title', 'Hunt and Gun Cowork')
      expect(chat).toHaveAttribute('data-compact', 'true')
      expect(chat).toHaveAttribute('data-include-all-scopes', 'false')
    })
  })

  it('locks contact embeds to the contact without listing every Messages thread', async () => {
    render(
      <EntityScopedChat
        orgId="org-1"
        entityType="contact"
        entityId="contact-ada"
        entityLabel="Ada Lovelace"
        href="/portal/contacts/contact-ada"
      />,
    )

    const chat = await screen.findByTestId('unified-chat')
    await waitFor(() => {
      expect(chat).toHaveAttribute('data-scope', 'contact')
      expect(chat).toHaveAttribute('data-scope-ref', 'contact-ada')
      expect(chat).toHaveAttribute('data-auto-title', 'Ada Lovelace contact workspace')
      expect(chat).toHaveAttribute('data-include-all-scopes', 'false')
    })
  })
})
