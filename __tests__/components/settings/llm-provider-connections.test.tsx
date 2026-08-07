import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LlmProviderConnections from '@/components/settings/LlmProviderConnections'

const CATALOG = {
  providers: [
    {
      key: 'anthropic',
      label: 'Anthropic Claude',
      description: 'Claude via API key. OAuth requires Claude Max + extra usage credits.',
      hermesProvider: 'anthropic',
      authKind: 'api_key_or_oauth',
      envVar: 'ANTHROPIC_API_KEY',
      credentialFields: [{ key: 'apiKey', label: 'Anthropic API key', secret: true, placeholder: 'sk-ant-…' }],
      consoleUrl: 'https://console.anthropic.com/settings/keys',
      curatedModels: ['claude-sonnet-4-6'],
      oauthCapable: true,
    },
    {
      key: 'xai-oauth',
      label: 'xAI Grok (SuperGrok OAuth)',
      description: 'Sign in with SuperGrok or X Premium+ — no API key required.',
      hermesProvider: 'xai-oauth',
      authKind: 'oauth',
      credentialFields: [],
      curatedModels: ['grok-4.20'],
      oauthCapable: true,
    },
    {
      key: 'xai',
      label: 'xAI Grok (API key)',
      description: 'Pay-per-token Grok models via XAI_API_KEY.',
      hermesProvider: 'xai',
      authKind: 'api_key',
      envVar: 'XAI_API_KEY',
      credentialFields: [{ key: 'apiKey', label: 'xAI API key', secret: true, placeholder: 'xai-…' }],
      curatedModels: ['grok-4.20'],
      oauthCapable: false,
    },
  ],
  connections: [],
  bindings: [],
  canManageOrgConnections: true,
  syncTargets: { orgVpsDeviceCount: 0, hasHermesProfileLink: true, targetCount: 1 },
  notes: {},
}

const ANTHROPIC_AUTH_SESSION = {
  id: 'oauth_anthropic_1',
  provider: 'anthropic',
  hermesProvider: 'anthropic',
  orgId: 'org-1',
  ownerUid: 'user-1',
  scope: 'user',
  label: 'Anthropic Claude',
  flow: 'authorization_code',
  status: 'awaiting_code',
  authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  userCode: '',
  verificationUri: null,
  verificationUriComplete: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
  intervalSeconds: 0,
  error: null,
  createdAt: null,
  updatedAt: null,
}

function mockCatalogFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/v1/llm-providers/connections?orgId=')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: CATALOG }),
      } as Response
    }
    if (url.includes('/oauth/start')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: { session: ANTHROPIC_AUTH_SESSION } }),
      } as Response
    }
    if (url.includes('/oauth/') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            session: { ...ANTHROPIC_AUTH_SESSION, status: 'completed' },
            connection: { id: 'conn-1', provider: 'anthropic', authKind: 'oauth_token' },
          },
        }),
      } as Response
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) } as Response
  }) as jest.Mock
}

function connectButtonFor(label: string): HTMLElement | undefined {
  const buttons = screen.getAllByRole('button', { name: 'Connect' })
  return buttons.find((button) => button.closest('div')?.textContent?.includes(label))
}

describe('LlmProviderConnections ConnectForm — anthropic dual option', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCatalogFetch()
    // Component scrolls the pending banner into view only when a session exists.
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders BOTH Connect with OAuth and the API key field for anthropic', async () => {
    render(<LlmProviderConnections orgId="org-1" />)

    const anthropicConnect = await screen.findByText('Anthropic Claude')
    expect(anthropicConnect).toBeInTheDocument()

    const button = connectButtonFor('Anthropic Claude')
    expect(button).toBeTruthy()
    fireEvent.click(button!)

    // OAuth primary option
    expect(await screen.findByRole('button', { name: 'Connect with OAuth' })).toBeInTheDocument()
    // API key field still offered
    expect(screen.getByPlaceholderText('sk-ant-…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & sync to org VPS' })).toBeInTheDocument()
    // Required plan caveat copy
    expect(screen.getByText(/Claude Max plan with purchased extra usage credits/i)).toBeInTheDocument()
    expect(screen.getByText(/Claude Pro cannot use this path/i)).toBeInTheDocument()
  })

  it('keeps the device-code UX unchanged for xai-oauth (OAuth only, no API key field)', async () => {
    render(<LlmProviderConnections orgId="org-1" />)

    await screen.findByText('xAI Grok (SuperGrok OAuth)')
    const button = connectButtonFor('xAI Grok (SuperGrok OAuth)')
    expect(button).toBeTruthy()
    fireEvent.click(button!)

    expect(await screen.findByRole('button', { name: 'Sign in with xAI Grok (SuperGrok OAuth)' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('xai-…')).not.toBeInTheDocument()
    expect(screen.queryByText(/Claude Max plan/i)).not.toBeInTheDocument()
  })

  it('keeps API-key-only providers free of the OAuth button', async () => {
    render(<LlmProviderConnections orgId="org-1" />)

    await screen.findByText('xAI Grok (API key)')
    const button = connectButtonFor('xAI Grok (API key)')
    expect(button).toBeTruthy()
    fireEvent.click(button!)

    expect(await screen.findByPlaceholderText('xai-…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect with OAuth' })).not.toBeInTheDocument()
  })

  it('shows the paste-code banner and scrolls it into view for the anthropic awaiting_code flow', async () => {
    const scrollSpy = jest.fn()
    Element.prototype.scrollIntoView = scrollSpy
    render(<LlmProviderConnections orgId="org-1" />)

    await screen.findByText('Anthropic Claude')
    const button = connectButtonFor('Anthropic Claude')
    expect(button).toBeTruthy()
    fireEvent.click(button!)

    fireEvent.click(await screen.findByRole('button', { name: 'Connect with OAuth' }))

    // The Complete sign-in banner must be visible with a place to paste the key.
    expect(await screen.findByText('Complete sign-in')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Paste the code from Anthropic here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit code' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open sign-in page' })).toHaveAttribute(
      'href',
      'https://claude.ai/oauth/authorize?client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    )
    // awaiting_code must auto-scroll the banner into view (same as device code).
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('splits the copied code#state string when submitting the paste-code form', async () => {
    render(<LlmProviderConnections orgId="org-1" />)

    await screen.findByText('Anthropic Claude')
    const button = connectButtonFor('Anthropic Claude')
    expect(button).toBeTruthy()
    fireEvent.click(button!)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect with OAuth' }))

    const input = await screen.findByPlaceholderText('Paste the code from Anthropic here')
    fireEvent.change(input, { target: { value: 'callback-code#callback-state' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }))

    await waitFor(() => {
      const exchangeCall = (global.fetch as jest.Mock).mock.calls.find(([inputUrl]) =>
        String(inputUrl).includes('/exchange'),
      )
      expect(exchangeCall).toBeTruthy()
      const body = JSON.parse(String(exchangeCall![1].body))
      expect(body).toEqual({ code: 'callback-code', state: 'callback-state' })
    })
  })
})
