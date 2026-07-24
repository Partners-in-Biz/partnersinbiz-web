/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ParticipantPicker from '@/components/chat/ParticipantPicker'

describe('ParticipantPicker runtime agent gate', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) {
        return {
          json: async () => ({
            data: [
              { agentId: 'pip', name: 'Pip', role: 'Operator', persona: '', iconKey: 'smart_toy', colorKey: 'violet', enabled: true, baseUrl: '', apiKey: '', defaultModel: '' },
              { agentId: 'theo', name: 'Theo', role: 'Engineer', persona: '', iconKey: 'code', colorKey: 'sky', enabled: true, baseUrl: '', apiKey: '', defaultModel: '' },
            ],
          }),
        } as Response
      }
      if (url.includes('/contacts')) {
        return {
          json: async () => ({
            data: [
              { uid: 'admin-1', displayName: 'Peet Stander', email: 'peet.stander@partnersinbiz.online', role: 'admin' },
            ],
          }),
        } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('shows org-visible agents when no machine filter is applied', async () => {
    render(
      <ParticipantPicker orgId="org-1" onSelect={jest.fn()} allowedAgentIds={null} />,
    )
    expect(await screen.findByText('Pip')).toBeInTheDocument()
    expect(screen.getByText('Theo')).toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
  })

  it('filters agents to the selected machine inventory and keeps people', async () => {
    render(
      <ParticipantPicker
        orgId="org-1"
        onSelect={jest.fn()}
        allowedAgentIds={['theo']}
      />,
    )
    expect(await screen.findByText('Theo')).toBeInTheDocument()
    expect(screen.queryByText('Pip')).not.toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
  })

  it('explains why agents are hidden while awaiting a computer', async () => {
    render(
      <ParticipantPicker
        orgId="org-1"
        onSelect={jest.fn()}
        allowedAgentIds={[]}
        agentsUnavailableReason="Select a computer first to see which agents are available there."
      />,
    )
    expect(await screen.findByTestId('agents-unavailable-reason')).toHaveTextContent(
      'Select a computer first to see which agents are available there.',
    )
    expect(screen.queryByText('Pip')).not.toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
  })

  it('drops a selected agent when the machine inventory no longer includes it', async () => {
    const onSelect = jest.fn()
    const { rerender } = render(
      <ParticipantPicker orgId="org-1" onSelect={onSelect} allowedAgentIds={null} />,
    )
    const pip = await screen.findByText('Pip')
    fireEvent.click(pip.closest('label')!)
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ kind: 'agent', agentId: 'pip' })]),
      )
    })

    rerender(
      <ParticipantPicker orgId="org-1" onSelect={onSelect} allowedAgentIds={['theo']} />,
    )
    await waitFor(() => {
      const last = onSelect.mock.calls.at(-1)?.[0] as Array<{ kind: string; agentId?: string }>
      expect(last.some((item) => item.kind === 'agent' && item.agentId === 'pip')).toBe(false)
    })
    expect(screen.queryByText('Pip')).not.toBeInTheDocument()
    expect(screen.getByText('Theo')).toBeInTheDocument()
  })
})
