/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ParticipantPicker from '@/components/chat/ParticipantPicker'

describe('ParticipantPicker runtime agent gate', () => {
  const workforceBlueprintSuccess = {
    matchSource: 'department',
    member: { jobTitle: 'Project Manager', department: 'Project Delivery' },
    blueprint: {
      id: 'project_delivery',
      label: 'Project delivery',
      summary: 'Planning, implementation, quality assurance, and documentation.',
      recommendedAgentIds: ['pip', 'theo', 'qa-release', 'docs'],
      specialistGaps: [],
    },
    policyEvidence: {
      policyReady: true,
      policyVersion: 'agent-policy-v1',
      agents: [
        {
          agentId: 'pip',
          policyDefined: true,
          policyLabel: 'Pip',
          expectedSkillCount: 3,
          approvalGates: ['approve'],
        },
        {
          agentId: 'theo',
          policyDefined: true,
          policyLabel: 'Theo',
          expectedSkillCount: 3,
          approvalGates: ['approve'],
        },
      ],
      skillCoverage: [
        { skillId: 'project-management', coveredByAgentIds: ['pip'] },
      ],
    },
    recommendationStatus: 'ready_for_owner_review' as const,
    requiresOwnerApproval: true,
  }

  const workforceBlueprintMissingPolicy = {
    ...workforceBlueprintSuccess,
    policyEvidence: {
      ...workforceBlueprintSuccess.policyEvidence,
      policyReady: false,
      policyVersion: 'agent-policy-v1',
      agents: [
        {
          ...workforceBlueprintSuccess.policyEvidence.agents[0],
          agentId: 'pip',
          policyDefined: false,
          approvalGates: ['approve'],
        },
        workforceBlueprintSuccess.policyEvidence.agents[1],
      ],
      skillCoverage: [],
    },
  }

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
      if (url.includes('/workforce-blueprint')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: workforceBlueprintSuccess }),
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
    expect(screen.getByLabelText('Select department Unassigned (0/1)')).toBeInTheDocument()
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
    expect(screen.getByLabelText('Select department Unassigned (0/1)')).toBeInTheDocument()
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
    expect(screen.getByLabelText('Select department Unassigned (0/1)')).toBeInTheDocument()
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
      if (url.includes('/workforce-blueprint')) {
        return { ok: true, status: 200, json: async () => ({ data: workforceBlueprintMissingPolicy }) } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} allowedAgentIds={null} />)
    expect(await screen.findByText('Pip')).toBeInTheDocument()
    expect(screen.getByTestId('participants-people-warning')).toHaveTextContent(/privacy blockers|Could not reach/i)
    expect(screen.queryByTestId('participants-load-error')).not.toBeInTheDocument()
  })

  it('adds and removes a full department group with one click', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response
      }
      if (url.includes('/people') || url.includes('/contacts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { uid: 'm-1', displayName: 'Ava One', email: 'ava.one@partner.in', role: 'admin', department: 'Marketing' },
              { uid: 'm-2', displayName: 'Ben Two', email: 'ben.two@partner.in', role: 'admin', department: 'Marketing' },
            ],
          }),
        } as Response
      }
      if (url.includes('/workforce-blueprint')) {
        return { ok: true, status: 200, json: async () => ({ data: workforceBlueprintSuccess }) } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const onSelect = jest.fn()
    render(<ParticipantPicker orgId="org-1" onSelect={onSelect} allowedAgentIds={null} />)

    const groupToggle = await screen.findByLabelText('Select department Marketing (0/2)')
    fireEvent.click(groupToggle)
    await waitFor(() => {
      const lastSelection = onSelect.mock.calls.at(-1)?.[0] as Array<{ kind: string; uid?: string }>;
      expect(lastSelection).toHaveLength(2)
      expect(lastSelection).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'user', uid: 'm-1' }),
          expect.objectContaining({ kind: 'user', uid: 'm-2' }),
        ]),
      )
    })

    fireEvent.click(groupToggle)
    await waitFor(() => {
      const finalSelection = onSelect.mock.calls.at(-1)?.[0] as Array<{ kind: string; uid?: string }>;
      expect(finalSelection).toEqual([])
    })
  })

  it('requests /people rather than /contacts to avoid privacy-filter blocks', async () => {
    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} />)
    await screen.findByText('Pip')
    const urls = (global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/people'))).toBe(true)
    expect(urls.some((url) => url.includes('/contacts'))).toBe(false)
  })

  it('shows role recommendations without auto-selecting or expanding access', async () => {
    const onSelect = jest.fn()
    render(<ParticipantPicker orgId="org-1" onSelect={onSelect} allowedAgentIds={['theo']} />)

    const blueprint = await screen.findByTestId('workforce-blueprint')
    expect(blueprint).toHaveTextContent('Recommended for Project delivery')
    expect(blueprint).toHaveTextContent('1/4 available here')
    expect(blueprint).toHaveTextContent('3 recommended agents need an owner grant or ready runtime')
    expect(blueprint).toHaveTextContent('Policy ready: yes • policy vagent-policy-v1')
    expect(blueprint).toHaveTextContent('Recommendations do not change your access')
    expect(screen.getByText('Theo')).toBeInTheDocument()
    expect(screen.queryByText('Pip')).not.toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()

    await waitFor(() => {
      expect(onSelect).toHaveBeenLastCalledWith([])
    })
  })

  it('shows agent policy status and skill coverage in picker rows', async () => {
    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} allowedAgentIds={null} />)

    const theo = await screen.findByText('Theo')
    expect(theo).toBeInTheDocument()
    expect(screen.getByText('Covers 1 required skill')).toBeInTheDocument()
    expect(screen.queryByText('Policy missing')).not.toBeInTheDocument()
  })

  it('shows policy evidence warning when policy is incomplete', async () => {
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
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response
      }
      if (url.includes('/workforce-blueprint')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: workforceBlueprintMissingPolicy }),
        } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    render(<ParticipantPicker orgId="org-1" onSelect={jest.fn()} allowedAgentIds={null} />)

    expect(await screen.findByText('Policy ready: no • policy vagent-policy-v1')).toBeInTheDocument()
    expect(screen.getByText('1 recommended agents are missing policy definitions.')).toBeInTheDocument()
    expect(screen.getByText('Policy missing')).toBeInTheDocument()
  })

  it('sends selected workforce blueprint override to workforce API', async () => {
    const onSelect = jest.fn()
    render(
      <ParticipantPicker
        orgId="org-1"
        onSelect={onSelect}
        allowedAgentIds={null}
        workforceBlueprintId="finance"
      />,
    )

    expect(await screen.findByText('Pip')).toBeInTheDocument()
    const urls = (global.fetch as jest.Mock).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/workforce-blueprint?blueprint=finance'))).toBe(true)
  })
})
