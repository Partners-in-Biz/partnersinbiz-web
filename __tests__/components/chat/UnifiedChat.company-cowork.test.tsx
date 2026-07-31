import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import UnifiedChat from '@/components/chat/UnifiedChat'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('UnifiedChat CRM company Cowork', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('auto-creates a company session on the org default VPS and keeps Mac selectable', async () => {
    const creates: Array<Record<string, unknown>> = []
    const created = {
      id: 'conv-company-auto',
      orgId: 'org-1',
      participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
      participantUids: ['user-1'],
      participantAgentIds: ['pip'],
      startedBy: 'user-1',
      title: 'Hunt and Gun Cowork',
      scope: 'company',
      scopeRefId: 'company-hunt',
      messageCount: 0,
      archived: false,
      contextRefs: [],
      workspaceContext: {
        workspaceId: 'partners',
        orgName: 'Partners in Biz',
        runtimeTarget: 'partners-vps',
        runtimeLabel: 'Partners VPS',
        companyId: 'company-hunt',
        companyName: 'Hunt and Gun',
      },
    }

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse({ data: { agentId: 'pip', canSelect: false, models: [], providers: [] } })
      if (url.includes('/visible-agents')) {
        return jsonResponse({
          data: [{
            agentId: 'pip', name: 'Pip', role: 'Operator', persona: '', iconKey: 'hub', colorKey: 'violet',
            enabled: true, baseUrl: '', apiKey: '', defaultModel: 'auto',
          }],
        })
      }
      if (url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) {
        return jsonResponse({
          data: {
            workspaces: [{
              workspaceId: 'partners', orgId: 'org-1', orgSlug: 'partners', orgName: 'Partners in Biz',
              agentDomain: 'partners', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'vps', folderVersion: 1,
            }],
              runtimeTargetsByWorkspace: {
              partners: [{
                id: 'device-mac', label: "Peet's Mac", mappingId: 'partners-mac-workspace',
                mappingLabel: 'Partners in Biz', selectable: true, enabled: true, isLocal: true,
                isFresh: true, isHealthy: true, lastSeenAt: null, deviceKind: 'computer',
              }, {
                id: 'partners-vps', label: 'Partners VPS', mappingId: 'partners-vps-workspace',
                mappingLabel: 'Partners in Biz', selectable: true, enabled: true, isLocal: false,
                isFresh: true, isHealthy: true, lastSeenAt: null, deviceKind: 'vps',
                ownerType: 'organization', visibility: 'organization',
                legacyRuntimeTargetIds: ['vps'],
              }],
            },
            projects: [],
          },
        })
      }
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: creates.length ? [created] : [] } })
      }
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      if (url === '/api/v1/conversations' && init?.method === 'POST') {
        creates.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return jsonResponse({ data: { conversation: created } }, 201)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        orgName="Hunt and Gun"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        scope="company"
        scopeRefId="company-hunt"
        initialAgentId="pip"
        autoCreateScopedConversation
        autoCreateTitle="Hunt and Gun Cowork"
        compact
      />,
    )

    await waitFor(() => expect(creates).toEqual([expect.objectContaining({
      scope: 'company',
      scopeRefId: 'company-hunt',
      workspaceId: 'partners',
      runtimeTarget: 'partners-vps',
      mappingId: 'partners-vps-workspace',
      shareMode: 'org',
    })]))

    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))
    const dialog = await screen.findByRole('dialog', { name: 'New conversation' })
    expect(within(dialog).getByTestId('locked-company-cowork-context')).toHaveTextContent('Hunt and Gun')
    expect(within(dialog).queryByLabelText('Conversation context')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Search accessible companies')).not.toBeInTheDocument()

    const computer = within(dialog).getByLabelText('Computer')
    await waitFor(() => expect(computer).toHaveValue('partners-vps::partners-vps-workspace'))
    expect(within(dialog).getByRole('option', { name: /^Partners VPS/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: /^Peet's Mac/ })).toBeInTheDocument()
    expect(within(dialog).getByText(/Defaults to this organisation’s VPS Cowork copy/i)).toBeInTheDocument()
  })
})
