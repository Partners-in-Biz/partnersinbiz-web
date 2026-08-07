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

function mockCatalogFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/llm-providers/connections?orgId=')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: CATALOG }),
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
})
