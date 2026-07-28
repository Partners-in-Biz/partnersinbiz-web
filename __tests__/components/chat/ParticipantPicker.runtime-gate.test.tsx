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
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { agentId: 'pip', name: 'Pip', role: 'Operator', persona: '', iconKey: 'smart_toy', colorKey: 'violet', enabled: true, baseUrl: '', apiKey: '', defaultModel: '' },
              { agentId: 'theo', name: 'Theo', role: 'Engineer', persona: '', iconKey: 'code', colorKey: 'sky', enabled: true, baseUrl: '', apiKey: '', defaultModel: '' },
            ],
          }),
        } as Response
      }
      if (url.includes('/people') || url.includes('/contacts')) {
        return {
          ok: true,
          status: 200,
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

  it('still shows agents when the people list fails (e.g. privacy filter)', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { agentId: 'pip', name: 'Pip', role: 'Operator', persona: '', iconKey: 'smart_toy', colorKey: 'violet', enabled: true, baseUrl: '', apiKey: '', defaultModel: '' },
            ],
          }),
        } as Response
      }
      if (url.includes('/people') || url.includes('/contacts')) {
        throw new TypeError('Failed to fetch')
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} allowedAgentIds={null} />)
    expect(await screen.findByText('Pip')).toBeInTheDocument()
    expect(screen.getByTestId('participants-people-warning')).toHaveTextContent(/privacy blockers|Could not reach/i)
    expect(screen.queryByTestId('participants-load-error')).not.toBeInTheDocument()
  })

  it('requests /people rather than /contacts to avoid privacy-filter blocks', async () => {
    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} />)
    await screen.findByText('Pip')
    const urls = (global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/people'))).toBe(true)
    expect(urls.some((url) => url.includes('/contacts'))).toBe(false)
  })
})
