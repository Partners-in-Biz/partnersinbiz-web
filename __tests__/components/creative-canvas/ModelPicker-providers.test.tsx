import { render, screen, fireEvent } from '@testing-library/react'
import ModelPicker from '@/components/creative-canvas/panels/ModelPicker'

describe('ModelPicker provider chips', () => {
  const onSelect = jest.fn()
  const onConnect = jest.fn()
  afterEach(() => { onSelect.mockReset(); onConnect.mockReset() })

  it('shows provider chips and filters models by provider', () => {
    render(<ModelPicker kind="image" connectedProviders={['higgsfield', 'xai']} onSelect={onSelect} onConnectProvider={onConnect} />)
    fireEvent.click(screen.getByRole('button', { name: 'xAI (Grok)' }))
    expect(screen.getByText('Grok Imagine')).toBeInTheDocument()
    expect(screen.queryByText('Soul 2.0')).not.toBeInTheDocument()
  })

  it('models from unconnected providers are hidden from All', () => {
    render(<ModelPicker kind="image" connectedProviders={['higgsfield']} onSelect={onSelect} onConnectProvider={onConnect} />)
    expect(screen.queryByText('Recraft V4')).not.toBeInTheDocument()
    expect(screen.getByText('Soul 2.0')).toBeInTheDocument()
  })

  it('unconnected provider chip is disabled and offers Connect', () => {
    render(<ModelPicker kind="image" connectedProviders={['higgsfield']} onSelect={onSelect} onConnectProvider={onConnect} />)
    expect(screen.getByRole('button', { name: 'Recraft' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /connect recraft/i }))
    expect(onConnect).toHaveBeenCalledWith('recraft')
  })

  it('defaults keep existing behaviour when connectedProviders is omitted (higgsfield/agent_task/xai visible)', () => {
    render(<ModelPicker kind="image" onSelect={onSelect} />)
    expect(screen.getByText('Soul 2.0')).toBeInTheDocument()
    expect(screen.getByText('Grok Imagine')).toBeInTheDocument()
    expect(screen.queryByText('Recraft V4')).not.toBeInTheDocument()
  })

  it('video kind filters chips to providers that have video models', () => {
    render(<ModelPicker kind="video" connectedProviders={['higgsfield', 'recraft']} onSelect={onSelect} onConnectProvider={onConnect} />)
    expect(screen.queryByRole('button', { name: 'Recraft' })).not.toBeInTheDocument()
  })
})
