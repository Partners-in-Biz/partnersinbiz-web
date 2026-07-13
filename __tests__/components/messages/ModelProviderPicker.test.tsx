import { fireEvent, render, screen } from '@testing-library/react'
import ModelProviderPicker from '@/components/messages/hermes/ModelProviderPicker'
import type { PublicMessageModelCatalog } from '@/lib/messages/model-catalog'

const catalog: PublicMessageModelCatalog = {
  agentId: 'pip',
  canSelect: true,
  currentModel: 'anthropic/claude-sonnet-4.6',
  currentProvider: 'anthropic',
  source: 'hermes',
  providers: [
    { id: 'anthropic', label: 'Anthropic', configured: true, active: true },
    { id: 'openai', label: 'Openai', configured: true, active: false },
  ],
  models: [
    {
      id: 'anthropic/claude-sonnet-4.6',
      model: 'anthropic/claude-sonnet-4.6',
      displayName: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      configured: true,
      active: true,
      available: true,
      source: 'hermes',
      supportsThinking: true,
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

    fireEvent.click(screen.getByRole('button', { name: /Auto model/i }))
    fireEvent.change(screen.getByPlaceholderText('Search models or providers'), { target: { value: 'gpt' } })
    fireEvent.click(screen.getByText('GPT-5.5').closest('button') as HTMLButtonElement)

    expect(onSelect).toHaveBeenCalledWith({ model: 'openai/gpt-5.5', provider: 'openai' })
  })

  it('persists pinned models in localStorage', () => {
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={null}
        onSelect={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Auto model/i }))
    fireEvent.click(screen.getByRole('button', { name: /Pin GPT-5.5/i }))

    expect(window.localStorage.getItem('pib.messages.pinnedModels.v1')).toContain('openai:openai/gpt-5.5')
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

    expect(screen.getByRole('button', { name: /Auto model/i })).toBeDisabled()
  })

  it('clears explicit model overrides when Auto model is selected', () => {
    const onSelect = jest.fn()
    render(
      <ModelProviderPicker
        catalog={catalog}
        selected={{ model: 'openai/gpt-5.5', provider: 'openai' }}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /GPT-5.5/i }))
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

    fireEvent.click(screen.getByRole('button', { name: /Auto model/i }))

    expect(screen.getByRole('dialog', { name: 'Choose model and provider' })).toHaveClass('bottom-full')
    expect(screen.getByTestId('model-provider-options')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })
})
