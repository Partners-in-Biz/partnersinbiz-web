import { fireEvent, render, screen } from '@testing-library/react'
import ModelProviderPicker from '@/components/messages/hermes/ModelProviderPicker'
import type { PublicMessageModelCatalog } from '@/lib/messages/model-catalog'

const catalog: PublicMessageModelCatalog = {
  agentId: 'pip',
  canSelect: true,
  currentModel: 'gpt-5.6-luna',
  currentProvider: 'openai-codex',
  autoModel: 'gpt-5.6-luna',
  autoProvider: 'openai-codex',
  autoLabel: 'openai-codex · gpt-5.6-luna',
  runtimeSource: 'live_config',
  source: 'hermes',
  selectableModelCount: 1,
  providers: [
    { id: 'openai-codex', label: 'Openai Codex', configured: true, active: true },
    { id: 'anthropic', label: 'Anthropic', configured: false, active: false },
  ],
  models: [
    {
      id: 'gpt-5.6-luna',
      model: 'gpt-5.6-luna',
      displayName: 'GPT 5.6 Luna',
      provider: 'openai-codex',
      providerLabel: 'Openai Codex',
      configured: true,
      active: true,
      available: true,
      connectionId: 'org:org-1:openai-codex',
      connectionLabel: 'Company ChatGPT',
      credentialBindingId: 'binding-openai',
      source: 'hermes',
    },
    {
      id: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      configured: false,
      active: false,
      available: false,
      source: 'hermes',
      reasonUnavailable: 'No credentials configured for Anthropic on this agent runtime.',
    },
    {
      id: 'openai/gpt-5.5',
      model: 'openai/gpt-5.5',
      displayName: 'GPT-5.5',
      provider: 'openai',
      providerLabel: 'Openai',
      configured: true,
      active: false,
      available: true,
      connectionId: 'org:org-1:openai-api',
      connectionLabel: 'Company OpenAI',
      credentialBindingId: 'binding-api',
      source: 'hermes',
    },
  ],
}

describe('ModelProviderPicker', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('opens a searchable model list and emits the selected provider/model', () => {
    const onSelect = jest.fn()
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={null}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model and provider/i }))
    expect(screen.getByText(/Uses live runtime openai-codex · gpt-5.6-luna/i)).toBeInTheDocument()
    expect(screen.getByText(/Needs credentials/i)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search models or providers'), { target: { value: 'gpt-5.5' } })
    fireEvent.click(screen.getByText('GPT-5.5').closest('button') as HTMLButtonElement)

    expect(onSelect).toHaveBeenCalledWith({
      model: 'openai/gpt-5.5',
      provider: 'openai',
      llmConnectionId: 'org:org-1:openai-api',
      llmCredentialBindingId: 'binding-api',
    })
  })

  it('persists pinned models in localStorage', () => {
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={null}
        onSelect={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model and provider/i }))
    fireEvent.click(screen.getByRole('button', { name: /Pin GPT-5.5/i }))

    expect(window.localStorage.getItem('pib.messages.pinnedModels.v1')).toContain('org:org-1:openai-api:openai:openai/gpt-5.5')
    expect(screen.getByRole('button', { name: /Unpin GPT-5.5/i })).toBeInTheDocument()
  })

  it('renders a disabled read-only chip when selection is unavailable', () => {
    render(
      <ModelProviderPicker
        catalog={{ ...catalog, canSelect: false }}
        selected={null}
        onSelect={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Select model and provider/i })).toBeDisabled()
  })

  it('clears explicit model overrides when Auto model is selected', () => {
    const onSelect = jest.fn()
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={{
          model: 'openai/gpt-5.5',
          provider: 'openai',
          llmConnectionId: 'org:org-1:openai-api',
          llmCredentialBindingId: 'binding-api',
        }}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model and provider/i }))
    fireEvent.click(screen.getByText('Auto model').closest('button') as HTMLButtonElement)

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('can open upward with a viewport-bounded list when used in the bottom composer bar', () => {
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={null}
        placement="top"
        onSelect={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model and provider/i }))

    expect(screen.getByRole('dialog', { name: 'Choose model and provider' })).toHaveClass('bottom-full')
    expect(screen.getByTestId('model-provider-options')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })

  it('opens a full-width high-contrast sheet on mobile', () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={null}
        compact
        placement="top"
        onSelect={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model and provider/i }))

    const dialog = screen.getByRole('dialog', { name: 'Choose model and provider' })
    expect(dialog).toHaveAttribute('data-presentation', 'sheet')
    expect(dialog.className).toContain('inset-x-0')
    expect(dialog.className).toContain('bg-[#161616]')
    expect(screen.getByRole('button', { name: 'Dismiss model picker' })).toBeInTheDocument()
  })
})
