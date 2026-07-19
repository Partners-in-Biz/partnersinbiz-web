import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import UnifiedChat, {
  formatConversationAttachmentUploadError,
  shouldStopFinalizePollingForStatus,
  uploadConversationAttachment,
} from '@/components/chat/UnifiedChat'
import type { ContextReference } from '@/lib/context-references/types'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

const baseConversation = {
  id: 'conv-1',
  orgId: 'org-1',
  participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
  participantUids: ['user-1'],
  participantAgentIds: ['pip'],
  startedBy: 'user-1',
  title: 'Launch chat',
  messageCount: 0,
  archived: false,
  contextRefs: [] as ContextReference[],
}

const contactRef: ContextReference = {
  type: 'contact',
  id: 'contact-1',
  orgId: 'org-1',
  label: 'Jane Client',
  origin: 'current_page',
  href: '/admin/crm/contacts/contact-1',
}

const projectRef: ContextReference = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Launch Project',
  origin: 'mention',
  summary: 'status: development',
}

const modelCatalogResponse = {
  data: {
    agentId: 'pip',
    canSelect: true,
    currentModel: 'anthropic/claude-sonnet-4.6',
    currentProvider: 'anthropic',
    source: 'hermes',
    providers: [{ id: 'anthropic', label: 'Anthropic', configured: true, active: true }],
    models: [{
      id: 'anthropic/claude-sonnet-4.6',
      model: 'anthropic/claude-sonnet-4.6',
      displayName: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      configured: true,
      active: true,
      available: true,
      source: 'hermes',
    }],
  },
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response
}

function errorResponse(status: number, body: unknown = { error: 'Unauthorized' }) {
  return {
    ok: false,
    status,
    json: async () => body,
  } as Response
}

describe('UnifiedChat upload and finalize error handling', () => {
  it('formats deployment-protection and network upload failures into useful user-facing errors', async () => {
    expect(formatConversationAttachmentUploadError(new Error('Failed to fetch'), 'photo.png')).toContain(
      'blocked before the app could receive photo.png',
    )

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '<!doctype html><title>Authentication Required</title>',
      json: async () => { throw new Error('not json') },
    } as Response))

    await expect(uploadConversationAttachment('conv-1', new File(['x'], 'photo.png', { type: 'image/png' })))
      .rejects.toThrow('Upload blocked before the app could receive photo.png')
  })

  it('treats missing finalize routes/resources as terminal instead of retryable polling failures', () => {
    expect(shouldStopFinalizePollingForStatus(400)).toBe(true)
    expect(shouldStopFinalizePollingForStatus(401)).toBe(true)
    expect(shouldStopFinalizePollingForStatus(403)).toBe(true)
    expect(shouldStopFinalizePollingForStatus(404)).toBe(true)
    expect(shouldStopFinalizePollingForStatus(502)).toBe(false)
    expect(shouldStopFinalizePollingForStatus(503)).toBe(false)
  })
})

describe('UnifiedChat Workspace catalogue privacy', () => {
  it('keeps the new conversation action visible by scrolling the modal body inside the phone viewport', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const trigger = await screen.findByRole('button', { name: /new conversation/i })
    const background = trigger.closest('aside')
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'New conversation' })
    expect(screen.getByTestId('accessible-dialog-panel')).toHaveClass('max-h-[100dvh]', 'flex-col', 'overflow-hidden')
    expect(screen.getByTestId('new-conversation-scroll-body')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(screen.getByRole('button', { name: 'Start conversation' }).parentElement).toHaveClass('shrink-0')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(background).toHaveAttribute('inert')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'New conversation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(background).not.toHaveAttribute('inert')
  })

  it('offers a prominent first-project path even when the organisation has no projects yet', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [], runtimeTargetsByWorkspace: {}, projects: [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    expect(await screen.findByText(/Use New project above to create your first project/i)).toBeInTheDocument()
    const createProject = screen.getByRole('button', { name: 'Create new project' })
    expect(createProject).toBeEnabled()
    fireEvent.click(createProject)

    const dialog = screen.getByRole('dialog', { name: 'New conversation' })
    expect(within(dialog).getByLabelText('Conversation context')).toHaveValue('project')
    expect(within(dialog).getByRole('combobox', { name: 'Project folder' })).toHaveTextContent('No projects available')
    const projectSetup = within(dialog).getByRole('region', { name: 'New project' })
    expect(within(projectSetup).getByRole('radio', { name: 'Link existing project' })).toBeChecked()
    expect(within(projectSetup).getByRole('radio', { name: 'Create new project' })).toBeEnabled()
    expect(within(projectSetup).getByRole('combobox', { name: 'Search accessible companies' })).toBeInTheDocument()
    expect(within(projectSetup).queryByRole('radio', { name: 'Full client workspace' })).not.toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^New conversation$/i }))
    expect(screen.queryByRole('region', { name: 'New project' })).not.toBeInTheDocument()
  })

  it('does not resurrect an unlinked project from its old conversations', async () => {
    const hiddenProjectConversation = {
      ...baseConversation,
      id: 'conv-hidden-project',
      title: 'Old migrated session',
      scope: 'project',
      scopeRefId: 'hidden-project',
      workspaceContext: { projectId: 'hidden-project', projectName: 'Hidden migrated project' },
    }
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [], runtimeTargetsByWorkspace: {}, projects: [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [hiddenProjectConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/conversations?')))
    expect(screen.queryByText('Hidden migrated project')).not.toBeInTheDocument()
    expect(screen.queryByText('Old migrated session')).not.toBeInTheDocument()
  })

  it('removes only the current user sidebar link and refreshes the project list', async () => {
    let removed = false
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [], runtimeTargetsByWorkspace: {},
        projects: removed ? [] : [{ id: 'project-1', name: 'Acme Cowork' }],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      if (url.startsWith('/api/v1/project-library?') && init?.method === 'DELETE') {
        removed = true
        return jsonResponse({ data: { projectId: 'project-1', removed: true } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Acme Cowork from my projects' }))

    await waitFor(() => expect(screen.queryByTestId('hermes-project-project-1')).not.toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/project-library?'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('finds an existing company Cowork and lets the user add it without creating a duplicate', async () => {
    let added = false
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?') && (!init?.method || init.method === 'GET')) return jsonResponse({ data: {
        company: { id: 'company-1', name: 'Acme' },
        projects: [{ id: 'project-acme', name: 'Acme Cowork', companyId: 'company-1', added }],
      } })
      if (url === '/api/v1/project-library' && init?.method === 'POST') {
        added = true
        return jsonResponse({ data: { projectId: 'project-acme', added: true } })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [], runtimeTargetsByWorkspace: {}, projects: added ? [{ id: 'project-acme', name: 'Acme Cowork' }] : [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create new project' }))
    const wizard = screen.getByRole('region', { name: 'New project' })
    fireEvent.change(within(wizard).getByRole('combobox', { name: 'Search accessible companies' }), { target: { value: 'Acme' } })
    fireEvent.click(await within(wizard).findByRole('button', { name: 'Acme' }))

    await within(wizard).findByRole('button', { name: 'Add Acme Cowork to my projects' })
    expect(within(wizard).queryByLabelText('Registered folder')).not.toBeInTheDocument()
    fireEvent.click(within(wizard).getByRole('radio', { name: 'Create new project' }))
    expect(within(wizard).queryByText(/already has a Cowork project/i)).not.toBeInTheDocument()
    fireEvent.click(within(wizard).getByRole('radio', { name: 'Link existing project' }))
    fireEvent.click(within(wizard).getByRole('button', { name: 'Add Acme Cowork to my projects' }))

    await waitFor(() => expect(screen.getByTestId('hermes-project-project-acme')).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/project-setups', expect.anything())
  })

  it('renders friendly VPS-canonical scope copy without raw filesystem paths', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) {
        return jsonResponse({
          data: {
            workspaces: [{
              workspaceId: 'acme',
              orgId: 'org-1',
              orgSlug: 'acme',
              orgName: 'Acme',
              agentDomain: 'acme',
              vpsPath: '/var/lib/hermes/Cowork/Acme',
              localPath: '~/Cowork/Acme',
              sourceOfTruth: 'vps',
              syncMode: 'hybrid',
              defaultRuntimeTarget: 'vps',
              folderVersion: 1,
            }, {
              workspaceId: 'beta', orgId: 'org-1', orgSlug: 'beta', orgName: 'Beta', agentDomain: 'beta',
              sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'vps', folderVersion: 1,
            }],
            runtimeTargets: [],
            runtimeTargetsByWorkspace: {
              acme: [{ id: 'device-a', label: 'Acme Mac', selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null }],
              beta: [{ id: 'device-b', label: 'Beta PC', selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null }],
            },
            projects: [],
          },
        })
      }
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [baseConversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({ data: { messages: [] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))
    const workspaceContextOption = screen.getByRole('option', { name: 'Organisation root folder' })
    fireEvent.change(workspaceContextOption.parentElement as HTMLSelectElement, { target: { value: 'workspace' } })

    expect(await screen.findByText(/Current organisation root folder/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Acme Mac · online' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beta PC/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/\/var\/lib\/hermes/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/~\/Cowork/i)).not.toBeInTheDocument()
  })

  it('shows Computer unavailable and disables the bound session composer without changing runtime', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'vps', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { acme: [
          { id: 'device-offline', label: 'Studio Mac', selectable: false, enabled: true, isLocal: true, isFresh: false, isHealthy: false, lastSeenAt: null },
          { id: 'device-healthy', label: 'Office PC', selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null },
        ] }, projects: [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [{ ...baseConversation, workspaceContext: { workspaceId: 'acme', orgName: 'Acme', runtimeTarget: 'device-offline', runtimeLabel: 'Studio Mac' } }] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Computer unavailable')).toBeInTheDocument()
    expect(alert).toHaveTextContent('Studio Mac is offline. This session remains linked to Studio Mac.')
    expect(screen.queryByText(/select another computer/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Office PC was selected/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Computer unavailable')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('keeps an adopted legacy-runtime session available through the linked computer alias', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'vps', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { acme: [{
          id: 'linked-device:mac-a', legacyRuntimeTargetIds: ['local'], label: 'Studio Mac', selectable: true,
          enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null,
        }] }, projects: [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [{ ...baseConversation, workspaceContext: { workspaceId: 'acme', orgName: 'Acme', runtimeTarget: 'local', runtimeLabel: 'Studio Mac' } }] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)
    const composer = await screen.findByPlaceholderText('Send a message')
    expect(composer).toBeEnabled()
    fireEvent.change(composer, { target: { value: 'Continue this session' } })
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    expect(screen.queryByText('Computer unavailable')).not.toBeInTheDocument()
  })

  it('does not invent a selectable VPS when a project has no available computer', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'vps', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { acme: [] },
        projects: [{ id: 'project-1', name: 'Launch Project' }],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))
    fireEvent.change(screen.getByLabelText('Conversation context'), { target: { value: 'project' } })

    const runtimeSelect = screen.getByRole('combobox', { name: 'Runtime' })
    expect(within(runtimeSelect).getByRole('option', { name: 'No linked computers available' })).toBeDisabled()
    expect(within(runtimeSelect).queryByRole('option', { name: 'VPS' })).not.toBeInTheDocument()
    expect(runtimeSelect).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled()
  })

  it('offers only computers linked to the selected project and blocks an unlinked project', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'runtime-vps', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { acme: [{
          id: 'runtime-vps', locationId: 'location-vps', workspaceId: 'acme', label: 'Client VPS',
          selectable: true, enabled: true, isLocal: false, isFresh: true, isHealthy: true, lastSeenAt: null,
        }, {
          id: 'runtime-mac', locationId: 'location-mac', workspaceId: 'acme', label: 'Studio Mac',
          selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null,
        }] },
        projects: [{
          id: 'project-mac', name: 'Mac project', locations: [{
            replicaId: 'replica-mac', locationId: 'location-mac', label: 'Studio Mac',
            workspaceId: 'acme', availability: 'online', syncStatus: 'synced', selectable: true, authenticatedRuntime: true,
          }],
        }, {
          id: 'project-pending', name: 'Pending project', locations: [{
            replicaId: 'replica-vps', locationId: 'location-vps', label: 'Client VPS',
            workspaceId: 'acme', availability: 'online', syncStatus: 'pending', selectable: false, authenticatedRuntime: true,
          }],
        }, { id: 'project-unlinked', name: 'Unlinked project', locations: [] }],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))
    fireEvent.change(screen.getByLabelText('Conversation context'), { target: { value: 'project' } })

    const projectSelect = screen.getByRole('combobox', { name: 'Project folder' })
    fireEvent.change(projectSelect, { target: { value: 'project-mac' } })
    const runtimeSelect = screen.getByRole('combobox', { name: 'Runtime' })
    await waitFor(() => expect(runtimeSelect).toHaveValue('runtime-mac'))
    expect(within(runtimeSelect).getByRole('option', { name: /Studio Mac/ })).toBeInTheDocument()
    expect(within(runtimeSelect).queryByRole('option', { name: /Client VPS/ })).not.toBeInTheDocument()

    fireEvent.change(projectSelect, { target: { value: 'project-pending' } })
    await waitFor(() => expect(runtimeSelect).toHaveValue(''))
    expect(within(runtimeSelect).getByRole('option', { name: 'No ready project computers available' })).toBeDisabled()
    expect(screen.getByText(/no linked computer currently has a ready project folder/i)).toBeInTheDocument()

    fireEvent.change(projectSelect, { target: { value: 'project-unlinked' } })
    await waitFor(() => expect(runtimeSelect).toHaveValue(''))
    expect(within(runtimeSelect).getByRole('option', { name: 'No linked computers available' })).toBeDisabled()
    expect(screen.getByText(/link a location to this project before starting a session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled()
  })

  it('refreshes computer availability every 30 seconds and clears that poll on unmount', async () => {
    let workspaceRequests = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) {
        workspaceRequests += 1
        return jsonResponse({ data: { workspaces: [], runtimeTargetsByWorkspace: {}, projects: [] } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')
    const view = render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)

    try {
      await waitFor(() => expect(workspaceRequests).toBe(1))
      const pollIndex = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 30_000)
      expect(pollIndex).toBeGreaterThanOrEqual(0)

      await act(async () => {
        const refresh = setIntervalSpy.mock.calls[pollIndex][0] as TimerHandler
        if (typeof refresh === 'function') refresh()
        await Promise.resolve()
      })
      await waitFor(() => expect(workspaceRequests).toBe(2))

      const pollHandle = setIntervalSpy.mock.results[pollIndex].value
      view.unmount()
      expect(clearIntervalSpy).toHaveBeenCalledWith(pollHandle)
    } finally {
      view.unmount()
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    }
  })

  it('refreshes the runtime catalogue for the agent selected in a new session', async () => {
    const workspaceUrls: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [{
        agentId: 'theo', name: 'Theo', role: 'Builder', persona: '', iconKey: 'code', colorKey: 'sky',
        enabled: true, baseUrl: '', apiKey: '', defaultModel: 'auto',
      }] })
      if (url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) {
        workspaceUrls.push(url)
        return jsonResponse({ data: { workspaces: [], runtimeTargetsByWorkspace: {}, projects: [] } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    await waitFor(() => expect(workspaceUrls.some((url) => url.includes('agentId=pip'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    const dialog = await screen.findByRole('dialog', { name: 'New conversation' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Theo Builder/ }))

    await waitFor(() => expect(workspaceUrls.some((url) => url.includes('agentId=theo'))).toBe(true))
  })

  it('renders the accepted computer receipt instead of the requested target echo', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [{ ...baseConversation, workspaceContext: { workspaceId: 'acme', runtimeTarget: 'requested-device', runtimeLabel: 'Requested Mac' } }] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [{
        id: 'm-2', conversationId: 'conv-1', role: 'assistant', content: 'Done', authorKind: 'agent', authorId: 'pip', authorDisplayName: 'Pip', status: 'completed', createdAt: '2026-07-13T09:00:00.000Z',
        acceptedDevice: { machineLabel: 'Actual Office PC', runtimeVersion: '2.4.1', acceptedAt: '2026-07-13T08:59:59.000Z' },
      }] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" />)
    expect(await screen.findByText('Accepted by Actual Office PC')).toBeInTheDocument()
    expect(screen.getByText(/Runtime 2.4.1/)).toBeInTheDocument()
    expect(screen.queryByText('Accepted by Requested Mac')).not.toBeInTheDocument()
  })
})

describe('UnifiedChat new project setup', () => {
  const workspace = {
    workspaceId: 'acme',
    orgId: 'org-1',
    orgSlug: 'acme',
    orgName: 'Acme',
    agentDomain: 'acme',
    sourceOfTruth: 'vps',
    syncMode: 'hybrid',
    defaultRuntimeTarget: 'runtime-mac',
    folderVersion: 1,
  }
  const runtimes = [{
    id: 'runtime-vps',
    label: 'Partners VPS',
    hostId: 'host-vps',
    mappingId: 'mapping-vps',
    workspaceId: 'acme',
    locationId: 'location-vps',
    locationLabel: 'Partners VPS',
    platform: 'linux',
    kind: 'linked-computer',
    deviceKind: 'vps',
    ownerType: 'organization',
    visibility: 'organization',
    selectable: true,
    enabled: true,
    isLocal: false,
    isFresh: true,
    isHealthy: true,
    lastSeenAt: '2026-07-13T18:00:00.000Z',
    ageSeconds: 8,
    lastHealthStatus: 'ok',
  }, {
    id: 'runtime-mac',
    label: 'Studio Mac',
    deviceId: 'device-mac',
    mappingId: 'mapping-mac',
    workspaceId: 'acme',
    locationId: 'location-mac',
    locationLabel: 'Studio Mac',
    platform: 'macos',
    kind: 'linked-computer',
    selectable: true,
    enabled: true,
    isLocal: true,
    isFresh: true,
    isHealthy: true,
    lastSeenAt: '2026-07-13T18:00:00.000Z',
    ageSeconds: 12,
    lastHealthStatus: 'ok',
  }, {
    id: 'runtime-office',
    label: 'Office PC',
    deviceId: 'device-office',
    mappingId: 'mapping-office',
    workspaceId: 'acme',
    locationId: 'location-office',
    platform: 'windows',
    kind: 'linked-computer',
    selectable: false,
    enabled: true,
    isLocal: true,
    isFresh: false,
    isHealthy: false,
    unavailableReason: 'offline',
    lastSeenAt: null,
    ageSeconds: null,
    lastHealthStatus: 'offline',
  }]

  async function openProjectWizard() {
    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))
    fireEvent.change(screen.getByLabelText('Conversation context'), { target: { value: 'project' } })
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    const wizard = screen.getByRole('region', { name: 'New project' })
    fireEvent.change(within(wizard).getByRole('combobox', { name: 'Search accessible companies' }), { target: { value: 'Acme' } })
    fireEvent.click(await within(wizard).findByRole('button', { name: 'Acme' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/project-library?')))
    return wizard
  }

  it('links a registered folder without exposing raw paths and selects the returned project', async () => {
    let workspaceRequests = 0
    let setupPayload: Record<string, unknown> | undefined
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) {
        workspaceRequests += 1
        return jsonResponse({ data: {
          workspaces: [workspace],
          runtimeTargetsByWorkspace: { acme: runtimes },
          projects: [
            { id: 'project-existing', name: 'Existing project' },
            ...(workspaceRequests > 1 ? [{ id: 'project-new', name: 'Website Refresh' }] : []),
          ],
        } })
      }
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [{
        id: 'folder-briefs',
        name: 'Client Briefs',
        paths: { vpsPath: '/srv/clients/acme/private', localPathHint: '/Users/peet/private' },
        syncState: { status: 'synced' },
      }] })
      if (url === '/api/v1/project-setups' && init?.method === 'POST') {
        setupPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse({ data: {
          projectId: 'project-new',
          project: { id: 'project-new', name: 'Website Refresh' },
          replicas: [{ locationId: 'location-mac', syncStatus: 'pending' }],
          plan: {
            state: 'awaiting_mapping_confirmation',
            completed: false,
            syncCompleted: false,
            actions: [{ type: 'confirm_existing_folder', status: 'required' }],
          },
        } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()

    expect(within(wizard).getByRole('radio', { name: 'Link existing project' })).toBeChecked()
    expect(within(wizard).getByRole('radio', { name: 'Create new project' })).toBeInTheDocument()
    expect(within(wizard).queryByRole('radio', { name: 'Full client workspace' })).not.toBeInTheDocument()
    fireEvent.change(within(wizard).getByLabelText('Project name'), { target: { value: 'Website Refresh' } })
    fireEvent.change(await within(wizard).findByLabelText('Registered folder'), { target: { value: 'folder-briefs' } })
    fireEvent.click(within(wizard).getByRole('checkbox', { name: /Studio Mac · online/ }))
    fireEvent.click(within(wizard).getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(setupPayload).toEqual({
      mode: 'existing_folder',
      orgId: 'org-1',
      companyId: 'company-1',
      projectName: 'Website Refresh',
      workspaceId: 'acme',
      workspaceFolderId: 'folder-briefs',
      locationId: 'location-vps',
      locationIds: ['location-vps', 'location-mac'],
      mappingId: 'mapping-vps',
    }))
    expect(await within(wizard).findByText('Pending mapping')).toBeInTheDocument()
    expect(within(wizard).getByText('Confirm existing folder')).toBeInTheDocument()
    expect(within(wizard).getByText(/Sync is not yet confirmed/)).toBeInTheDocument()
    expect(within(wizard).getByRole('button', { name: 'Continue to session' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Project folder' })).toHaveValue('project-new')
    expect(document.body).not.toHaveTextContent('/srv/clients/acme/private')
    expect(document.body).not.toHaveTextContent('/Users/peet/private')
  })

  it('requires an authorised registered folder instead of accepting a raw server path', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [workspace], runtimeTargetsByWorkspace: { acme: runtimes },
        projects: [{ id: 'project-existing', name: 'Existing project' }],
      } })
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()
    expect(await within(wizard).findByText(/must first be registered and mapped/i)).toBeInTheDocument()
    expect(within(wizard).queryByRole('textbox', { name: /path/i })).not.toBeInTheDocument()
    expect(within(wizard).getByRole('button', { name: 'Create project' })).toBeDisabled()
  })

  it('creates a standard PiB project on multiple selected computers and reports pending sync truthfully', async () => {
    let setupPayload: Record<string, unknown> | undefined
    const onlineRuntimes = runtimes.map((runtime) => runtime.id === 'runtime-office'
      ? { ...runtime, selectable: true, isFresh: true, isHealthy: true, unavailableReason: undefined }
      : runtime)
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [workspace], runtimeTargetsByWorkspace: { acme: onlineRuntimes },
        projects: [{ id: 'project-existing', name: 'Existing project' }],
      } })
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [] })
      if (url === '/api/v1/project-setups' && init?.method === 'POST') {
        setupPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse({ data: {
          projectId: 'project-standard',
          project: { id: 'project-standard', name: 'Growth Sprint', locationIds: ['location-vps', 'location-mac', 'location-office'] },
          plan: {
            state: 'awaiting_standard_provisioning', completed: false, syncCompleted: false,
            actions: [{ type: 'create_standard_project_folder', status: 'required' }],
          },
        } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()
    fireEvent.click(within(wizard).getByRole('radio', { name: 'Create new project' }))
    fireEvent.change(within(wizard).getByLabelText('Project name'), { target: { value: 'Growth Sprint' } })
    const canonicalVps = within(wizard).getByRole('checkbox', { name: /Partners VPS · Canonical VPS/ })
    await waitFor(() => expect(canonicalVps).toBeChecked())
    expect(canonicalVps).toBeDisabled()
    fireEvent.click(within(wizard).getByRole('checkbox', { name: /Studio Mac/ }))
    fireEvent.click(within(wizard).getByRole('checkbox', { name: /Office PC/ }))
    fireEvent.click(within(wizard).getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(setupPayload).toEqual({
      mode: 'standard', orgId: 'org-1', companyId: 'company-1', projectName: 'Growth Sprint', workspaceId: 'acme',
      locationIds: ['location-vps', 'location-mac', 'location-office'],
    }))
    expect(await within(wizard).findByText('Pending sync')).toBeInTheDocument()
    expect(within(wizard).getByText(/Sync is not yet confirmed/)).toBeInTheDocument()
    expect(within(wizard).queryByText(/^Sync complete/i)).not.toBeInTheDocument()
    expect(within(wizard).getByRole('button', { name: 'Continue to session' })).toBeDisabled()
  })

  it('shows an unavailable computer but prevents selecting it for project setup', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [workspace], runtimeTargetsByWorkspace: { acme: runtimes },
        projects: [{ id: 'project-existing', name: 'Existing project' }],
      } })
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()
    fireEvent.click(within(wizard).getByRole('radio', { name: 'Create new project' }))

    expect(within(wizard).getByRole('checkbox', { name: /Office PC · Computer unavailable/ })).toBeDisabled()
  })

  it('reuses one setup idempotency key when a failed request is retried', async () => {
    const setupKeys: Array<string | null> = []
    let setupAttempts = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [workspace], runtimeTargetsByWorkspace: { acme: runtimes },
        projects: [{ id: 'project-existing', name: 'Existing project' }],
      } })
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [{
        id: 'folder-briefs', name: 'Client Briefs', syncState: { status: 'synced' },
      }] })
      if (url === '/api/v1/project-setups' && init?.method === 'POST') {
        setupKeys.push(new Headers(init.headers).get('Idempotency-Key'))
        setupAttempts += 1
        if (setupAttempts === 1) return errorResponse(500, { error: 'Temporary setup failure' })
        return jsonResponse({ data: {
          projectId: 'project-retried',
          project: { id: 'project-retried', name: 'Retried project', locationIds: ['location-mac'] },
          plan: { state: 'awaiting_mapping_confirmation', completed: false, syncCompleted: false },
        } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()
    fireEvent.change(within(wizard).getByLabelText('Project name'), { target: { value: 'Retried project' } })
    fireEvent.change(await within(wizard).findByLabelText('Registered folder'), { target: { value: 'folder-briefs' } })
    fireEvent.click(within(wizard).getByRole('button', { name: 'Create project' }))

    expect(await within(wizard).findByRole('alert')).toHaveTextContent('Temporary setup failure')
    fireEvent.click(within(wizard).getByRole('button', { name: 'Create project' }))
    expect(await within(wizard).findByText('Pending mapping')).toBeInTheDocument()
    expect(setupKeys).toHaveLength(2)
    expect(setupKeys[0]).toEqual(expect.any(String))
    expect(setupKeys[0]).not.toBe('')
    expect(setupKeys[1]).toBe(setupKeys[0])
  })

  it('does not expose the legacy organisation-creating client setup mode', async () => {
    let setupPayload: Record<string, unknown> | undefined
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/crm/companies?')) return jsonResponse({ data: { companies: [{ id: 'company-1', name: 'Acme' }] } })
      if (url.startsWith('/api/v1/project-library?')) return jsonResponse({ data: { company: { id: 'company-1', name: 'Acme' }, projects: [] } })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [workspace], runtimeTargetsByWorkspace: { acme: runtimes },
        projects: [{ id: 'project-existing', name: 'Existing project' }],
      } })
      if (url.startsWith('/api/v1/workspace-folders?')) return jsonResponse({ data: [] })
      if (url === '/api/v1/project-setups' && init?.method === 'POST') {
        setupPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse({ data: {
          organizationId: 'north-star-org',
          organizationSlug: 'north-star',
          projectId: 'project-client',
          project: { id: 'project-client', name: 'North Star Launch', locationIds: [] },
          plan: {
            state: 'location_selection_pending', completed: false, syncCompleted: false,
            actions: [{ type: 'create_client_organization', status: 'completed' }],
          },
        } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" />)
    const wizard = await openProjectWizard()
    expect(within(wizard).queryByRole('radio', { name: 'Full client workspace' })).not.toBeInTheDocument()
    expect(setupPayload).toBeUndefined()
  })
})

describe('UnifiedChat project pulse integration', () => {
  const projectSeenKey = 'pib.messages.projectSeen.v1:org-1:conv-1:project-1'

  afterEach(() => {
    window.localStorage.removeItem(projectSeenKey)
  })

  it('loads project progress, anchors a living bundle, opens the lens, and resolves approval through the task API', async () => {
    window.localStorage.setItem(projectSeenKey, String(Date.parse('2026-07-12T08:00:00.000Z')))
    const conversation = { ...baseConversation, contextRefs: [projectRef] }
    const progress = {
      project: { id: 'project-1', name: 'Launch Project', status: 'active' },
      counts: { total: 2, complete: 0, running: 1, waiting: 0, blocked: 0, needsYou: 1, approvals: 1 },
      next: {
        id: 'approval', title: 'Approve sender', columnId: 'blocked', agentStatus: 'awaiting-input',
        state: 'needs_input', unresolvedDependencyIds: [], assigneeAgentId: 'pip', approvalStatus: 'pending', labels: ['approval-gate'],
        chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 1 },
      },
      tasks: [
        {
          id: 'draft', title: 'Draft copy', columnId: 'in_progress', agentStatus: 'in-progress', state: 'running',
          unresolvedDependencyIds: [], assigneeAgentId: 'maya', updatedAt: '2026-07-12T09:30:00.000Z',
          chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 0 },
        },
        {
          id: 'approval', title: 'Approve sender', columnId: 'blocked', agentStatus: 'awaiting-input', state: 'needs_input',
          unresolvedDependencyIds: [], assigneeAgentId: 'pip', approvalStatus: 'pending', labels: ['approval-gate'],
          chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 1 },
        },
      ],
      asOf: '2026-07-12T10:00:00.000Z',
    }
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [], projects: [{ id: 'project-1', name: 'Launch Project' }] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [conversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({ data: { messages: [
          {
            id: 'm-2', conversationId: 'conv-1', role: 'assistant', content: 'I created the linked work.',
            authorKind: 'agent', authorId: 'pip', authorDisplayName: 'Pip', status: 'completed', createdAt: '2026-07-12T09:00:00.000Z',
          },
          {
            id: 'm-3', conversationId: 'conv-1', role: 'assistant', content: 'This is an unrelated later response.',
            authorKind: 'agent', authorId: 'pip', authorDisplayName: 'Pip', status: 'completed', createdAt: '2026-07-12T09:05:00.000Z',
          },
        ] } })
      }
      if (url === '/api/v1/projects/project-1/chat-progress') return jsonResponse({ data: progress })
      if (url === '/api/v1/chat-context/project/project-1') return jsonResponse({ data: {
        context: { kind: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch Project', icon: 'rocket_launch' },
        pulse: { label: 'Launch Project', metrics: [{ id: 'complete', label: 'complete', value: '0/2' }], progress: { complete: 0, total: 2 } },
        groups: [], artifacts: [],
        attention: [{ id: 'approval', label: 'Approve sender', severity: 'approval', actions: [{ id: 'approve', label: 'Approve next step', href: '/api/v1/projects/project-1/tasks/approval', method: 'PATCH', requiresApproval: true }] }],
        activity: [], capabilities: [], asOf: progress.asOf,
      } })
      if (url === '/api/v1/projects/project-1/tasks/approval' && init?.method === 'PATCH') return jsonResponse({ data: { updated: true } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    global.fetch = fetchMock

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        layoutVariant="hermes"
        userRole="admin"
      />,
    )

    expect(await screen.findByTestId('context-pulse')).toHaveTextContent('0/2 complete')
    expect(screen.getByRole('button', { name: /Open context dock/i })).toHaveClass('focus-visible:ring-2')
    const conversationLog = screen.getByRole('log', { name: 'Conversation messages' })
    const matchingMessage = await screen.findByText('I created the linked work.')
    const unrelatedMessage = screen.getByText('This is an unrelated later response.')
    const directMessageChild = (element: HTMLElement) => {
      if (!conversationLog.contains(element)) throw new Error('Message is outside the conversation log')
      let node = element
      while (node.parentElement !== conversationLog) {
        if (!node.parentElement || !conversationLog.contains(node.parentElement)) {
          throw new Error('Message does not resolve to a direct conversation-log child')
        }
        node = node.parentElement
      }
      return node
    }
    expect(within(directMessageChild(matchingMessage)).getByText('2 linked tasks')).toBeInTheDocument()
    expect(within(directMessageChild(unrelatedMessage)).queryByText('2 linked tasks')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-composer-chip')).toHaveTextContent('Launch Project')

    const routineUpdates = await screen.findByRole('button', { name: /1 project update/i })
    expect(window.localStorage.getItem(projectSeenKey)).toBe(String(Date.parse(progress.asOf)))
    fireEvent.click(routineUpdates)
    expect(screen.queryByRole('button', { name: /project update/i })).not.toBeInTheDocument()
    expect(Number(window.localStorage.getItem(projectSeenKey))).toBeGreaterThanOrEqual(Date.parse(progress.asOf))

    fireEvent.click(screen.getByRole('button', { name: /Open context dock/i }))
    expect(screen.getByRole('dialog', { name: 'Launch Project context' })).toBeInTheDocument()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve next step' })[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/tasks/approval',
      expect.objectContaining({ method: 'PATCH' }),
    ))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/chat-context/project/project-1')).toHaveLength(2)
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/projects/project-1/chat-progress')).toHaveLength(2)
    })
  })

  it('uses one 5-second context coordinator with a 30-second derived fallback for legacy project bundles', async () => {
    jest.useFakeTimers()
    const conversation = { ...baseConversation, contextRefs: [projectRef] }
    const contextModel = {
      context: { kind: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch Project', icon: 'rocket_launch' },
      pulse: { label: 'Launch Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T10:00:00.000Z',
    }
    const progress = {
      project: { id: 'project-1', name: 'Launch Project', status: 'active' },
      counts: { total: 0, complete: 0, running: 0, waiting: 0, blocked: 0, needsYou: 0, approvals: 0 },
      tasks: [], asOf: '2026-07-13T10:00:00.000Z',
    }
    let contextRevision = 0
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [], projects: [{ id: 'project-1', name: 'Launch Project' }] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [conversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      if (url === '/api/v1/chat-context/project/project-1') return jsonResponse({ data: { ...contextModel, asOf: `2026-07-13T10:00:0${contextRevision++}.000Z` } })
      if (url === '/api/v1/projects/project-1/chat-progress') return jsonResponse({ data: progress })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    global.fetch = fetchMock

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" layoutVariant="hermes" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/chat-context/project/project-1')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/projects/project-1/chat-progress')).toHaveLength(1)

    await act(async () => { jest.advanceTimersByTime(5_100); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/chat-context/project/project-1')).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/projects/project-1/chat-progress')).toHaveLength(1)

    await act(async () => { jest.advanceTimersByTime(25_000); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/chat-context/project/project-1')).toHaveLength(7)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/projects/project-1/chat-progress')).toHaveLength(2)
    jest.useRealTimers()
  })
})

describe('UnifiedChat responsive Sessions focus mode', () => {
  const installViewport = (width: number) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((query: string) => ({
        matches: query.includes('max-width: 1279px')
          ? width <= 1279
          : query.includes('max-width: 1023px')
            ? width <= 1023
            : query.includes('min-width: 1280px')
              ? width >= 1280
              : false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    })
  }

  const installConversationFetch = () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [], projects: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [baseConversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
  }

  it('uses a focus-trapped Sessions slide-over at the 1194px landscape breakpoint and returns focus', async () => {
    installViewport(1194)
    installConversationFetch()
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" layoutVariant="hermes" />)

    const trigger = await screen.findByRole('button', { name: 'Open Sessions' })
    expect(trigger).toHaveClass('h-11', 'w-11', 'xl:hidden')
    const composer = await screen.findByPlaceholderText('Message Pip')
    fireEvent.change(composer, { target: { value: 'Keep this draft' } })
    fireEvent.click(trigger)

    const drawer = screen.getByRole('dialog', { name: 'Session browser' })
    expect(drawer).toHaveAttribute('data-presentation', 'drawer')
    expect(composer).toBeInTheDocument()
    expect(composer).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: 'Close sessions' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('expands a collapsed desktop rail and focuses its filter from Search sessions', async () => {
    installViewport(1440)
    installConversationFetch()
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" initialConvId="conv-1" layoutVariant="hermes" conversationRailMode="collapsed" onConversationRailModeChange={jest.fn()} />)

    const search = await screen.findByRole('button', { name: 'Search sessions' })
    expect(search).toHaveClass('h-11', 'w-11', 'xl:h-10', 'xl:w-10')
    fireEvent.click(search)
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Filter conversations' })).toHaveFocus())
  })
})

describe('UnifiedChat message scrolling', () => {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame
  let originalScrollHeightDescriptor: PropertyDescriptor | undefined
  let layoutSettled = false

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    layoutSettled = false
    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      layoutSettled = true
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = jest.fn()

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('aria-label') === 'Conversation messages' && layoutSettled ? 1200 : 0
      },
    })

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [baseConversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-old',
                conversationId: 'conv-1',
                role: 'user',
                content: 'First message',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
                createdAt: '2026-06-08T09:00:00.000Z',
              },
              {
                id: 'msg-latest',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Latest message',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                createdAt: '2026-06-08T09:05:00.000Z',
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeightDescriptor)
    } else {
      delete (HTMLElement.prototype as unknown as { scrollHeight?: number }).scrollHeight
    }
  })

  it('waits for the loaded conversation layout before scrolling to the latest message', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    await screen.findByText('Latest message')
    const log = screen.getByRole('log', { name: 'Conversation messages' })

    await waitFor(() => expect(window.requestAnimationFrame).toHaveBeenCalled())
    expect(log.scrollTop).toBe(1200)
  })

  it('keeps the classic layout by default and exposes the Hermes dense layout variant when requested', async () => {
    const { unmount } = render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    await screen.findByText('Latest message')
    expect(screen.getByTestId('unified-chat-root')).toHaveAttribute('data-layout-variant', 'classic')
    expect(screen.getByText('Conversations')).toBeInTheDocument()
    unmount()

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        layoutVariant="hermes"
      />,
    )

    await screen.findByText('Latest message')
    expect(screen.getByTestId('unified-chat-root')).toHaveAttribute('data-layout-variant', 'hermes')
    expect(screen.getByText('Sessions')).toBeInTheDocument()
  })

  it('groups Hermes sessions into pinned, company Cowork, project, agent, and recent areas without changing the classic rail', async () => {
    window.localStorage.setItem('pib.messages.expandedSessionGroups.v1:org-1', JSON.stringify(['project:project-1']))
    window.localStorage.setItem('pib.messages.pinnedConversations.v1:org-1', JSON.stringify(['conv-pinned']))
    const conversations = [
      {
        ...baseConversation,
        id: 'conv-pinned',
        title: 'Pinned launch',
        lastMessagePreview: 'Keep this handy',
        lastMessageAt: { seconds: 10 },
        messageCount: 3,
      },
      {
        ...baseConversation,
        id: 'conv-company',
        title: 'AHS Law check-in',
        scope: 'company',
        scopeRefId: 'company-ahs',
        workspaceContext: {
          workspaceId: 'partners', orgName: 'Partners in Biz', runtimeTarget: 'device-mac', runtimeLabel: "Peet's Mac",
          companyId: 'company-ahs', companyName: 'AHS Law', folderScope: 'company' as const,
        },
        lastMessagePreview: 'Company root thread',
        lastMessageAt: { seconds: 9 },
      },
      {
        ...baseConversation,
        id: 'conv-project',
        title: 'Website project',
        scope: 'project',
        contextRefs: [projectRef],
        lastMessagePreview: 'Project thread',
        lastMessageAt: { seconds: 9 },
      },
      {
        ...baseConversation,
        id: 'conv-agent',
        title: 'Pip agent run',
        orchestration: {
          mode: 'pip-orchestrator' as const,
          dispatcherAgentId: 'pip',
          requestedAgentIds: ['pip'],
        },
        lastMessagePreview: 'Agent workstream',
        lastMessageAt: { seconds: 8 },
      },
      {
        ...baseConversation,
        id: 'conv-recent',
        title: 'General inbox',
        participants: [{ kind: 'user' as const, uid: 'client-1', role: 'client' as const, displayName: 'Client One' }],
        participantAgentIds: [],
        lastMessagePreview: 'Recent thread',
        lastMessageAt: { seconds: 7 },
      },
    ]

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [], projects: [{ id: 'project-1', name: 'Launch Project' }] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const { unmount } = render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        layoutVariant="hermes"
      />,
    )

    expect(await screen.findByTestId('hermes-session-section-pinned')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-pinned')).getByText('Pinned launch')).toBeInTheDocument()
    const companyFolder = screen.getByTestId('hermes-company-company-ahs')
    expect(within(companyFolder).getByText('AHS Law')).toBeInTheDocument()
    expect(within(companyFolder).queryByText('AHS Law check-in')).not.toBeInTheDocument()
    fireEvent.click(within(companyFolder).getByRole('button', { name: 'Expand sessions for AHS Law' }))
    expect(within(companyFolder).getByText('AHS Law check-in')).toBeInTheDocument()
    expect(screen.getByTestId('hermes-session-section-agents')).not.toHaveTextContent('AHS Law check-in')
    const projectFolder = screen.getByTestId('hermes-project-project-1')
    const expandProject = within(projectFolder).queryByRole('button', { name: 'Expand sessions for Launch Project' })
    if (expandProject) fireEvent.click(expandProject)
    expect(within(projectFolder).getByText('Website project')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-agents')).getByText('Pip agent run')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-recent')).getByText('General inbox')).toBeInTheDocument()

    expect(within(companyFolder).getByRole('button', { name: 'Start session in AHS Law' })).toBeEnabled()
    unmount()

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    await screen.findByText('Conversations')
    expect(screen.queryByTestId('hermes-session-section-pinned')).not.toBeInTheDocument()
    expect(screen.getByTestId('conversation-row-conv-pinned')).toBeInTheDocument()
  })

  it('renders catalogue projects first, nests multiple sessions, and preselects an empty project from its add action', async () => {
    window.localStorage.setItem('pib.messages.expandedSessionGroups.v1:org-1', JSON.stringify(['project:project-1']))
    window.localStorage.setItem('pib.messages.pinnedConversations.v1:org-1', JSON.stringify(['conv-general']))
    const conversations = [
      {
        ...baseConversation,
        id: 'conv-project-one',
        title: 'Homepage implementation',
        scope: 'project',
        scopeRefId: 'project-1',
        contextRefs: [projectRef],
        workspaceContext: {
          workspaceId: 'acme', orgName: 'Acme', runtimeTarget: 'device-mac', runtimeLabel: 'Studio Mac',
          projectId: 'project-1', projectName: 'Launch Project',
        },
      },
      {
        ...baseConversation,
        id: 'conv-project-two',
        title: 'Launch checklist',
        scope: 'project',
        scopeRefId: 'project-1',
        contextRefs: [projectRef],
        workspaceContext: {
          workspaceId: 'acme', orgName: 'Acme', runtimeTarget: 'partners-vps', runtimeLabel: 'Partners VPS',
          projectId: 'project-1', projectName: 'Launch Project',
        },
      },
      {
        ...baseConversation,
        id: 'conv-general',
        title: 'Direct check-in',
        participants: [{ kind: 'user' as const, uid: 'client-1', role: 'client' as const, displayName: 'Client One' }],
        participantAgentIds: [],
      },
    ]

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'device-mac', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { acme: [
          { id: 'device-mac', label: 'Studio Mac', selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null },
          { id: 'partners-vps', label: 'Partners VPS', selectable: true, enabled: true, isLocal: false, isFresh: true, isHealthy: true, lastSeenAt: null },
        ] },
        projects: [
          { id: 'project-1', name: 'Launch Project' },
          { id: 'project-empty', name: 'Empty Project' },
        ],
      } })
      if (url === '/api/v1/projects/project-1/access?orgId=org-1') return jsonResponse({ data: {
        members: [], memberCandidates: [], organizations: [], invites: [],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    const launchProject = await screen.findByTestId('hermes-project-project-1')
    expect(within(launchProject).getByText('Launch Project')).toBeInTheDocument()
    const collapseLaunch = await within(launchProject).findByRole('button', { name: 'Collapse sessions for Launch Project' })
    expect(within(launchProject).getByTestId('conversation-row-conv-project-one')).toHaveTextContent('Homepage implementation')
    expect(within(launchProject).getByTestId('conversation-row-conv-project-one')).toHaveTextContent('Studio Mac')
    expect(within(launchProject).getByTestId('conversation-row-conv-project-two')).toHaveTextContent('Launch checklist')
    expect(within(launchProject).getByTestId('conversation-row-conv-project-two')).toHaveTextContent('Partners VPS')
    fireEvent.click(collapseLaunch)
    expect(within(launchProject).queryByTestId('conversation-row-conv-project-one')).not.toBeInTheDocument()
    fireEvent.click(within(launchProject).getByRole('button', { name: 'Expand sessions for Launch Project' }))

    fireEvent.click(within(launchProject).getByRole('button', { name: 'Link client organisation to Launch Project' }))
    const accessDialog = await screen.findByRole('dialog', { name: 'Project access for Launch Project' })
    expect(within(accessDialog).getByRole('heading', { name: 'Link client organisation to Launch Project' })).toBeInTheDocument()
    expect(within(accessDialog).getByRole('heading', { name: 'External organisations' })).toBeInTheDocument()
    fireEvent.click(within(accessDialog).getByRole('button', { name: 'Close' }))

    const emptyProject = screen.getByTestId('hermes-project-project-empty')
    fireEvent.click(within(emptyProject).getByRole('button', { name: 'Expand sessions for Empty Project' }))
    expect(within(emptyProject).getByText('No sessions yet')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-pinned')).getByText('Direct check-in')).toBeInTheDocument()

    fireEvent.click(within(emptyProject).getByRole('button', { name: 'Start session for Empty Project' }))
    expect(screen.getByRole('dialog', { name: 'New conversation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Conversation context')).toHaveValue('project')
    expect(screen.getByRole('combobox', { name: 'Project folder' })).toHaveValue('project-empty')
  })

  it('renders only server-summary project location badges and never exposes path metadata', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [],
        runtimeTargetsByWorkspace: {},
        projects: [{
          id: 'project-1',
          name: 'Launch Project',
          locations: [{
            replicaId: 'replica-vps', locationId: 'location-vps', label: 'Partners VPS',
            kind: 'vps', platform: 'linux', availability: 'online', selectable: true, authenticatedRuntime: true,
            syncStatus: 'synced', relativePath: 'clients/private/project',
          }, {
            replicaId: 'replica-mac', locationId: 'location-mac', locationLabel: 'Studio Mac',
            kind: 'computer', platform: 'macos', authenticatedRuntime: true,
            // The persisted replica can still say online after a heartbeat goes
            // stale. Explicit catalogue presence must win for the badge.
            availability: 'online', selectable: false, syncStatus: 'offline', localPath: '/Users/peet/private/project',
          }, {
            replicaId: 'replica-legacy', locationId: 'legacy-mac', label: 'Old Mac',
            kind: 'computer', platform: 'macos', availability: 'online', selectable: true,
          }],
        }, { id: 'project-empty', name: 'No locations project' }],
      } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    const project = await screen.findByTestId('hermes-project-project-1')
    expect(within(project).getByTestId('project-location-badge-project-1-location-vps')).toHaveTextContent('VPS · Partners VPS · online')
    expect(within(project).getByTestId('project-location-badge-project-1-location-mac')).toHaveTextContent('Computer · Studio Mac · Computer unavailable')
    expect(within(project).getByTestId('project-location-badge-project-1-legacy-mac')).toHaveTextContent('Computer · Old Mac · Pairing required')
    expect(within(project).getByTestId('project-location-badge-project-1-location-mac')).toHaveAccessibleName('Computer Studio Mac: Computer unavailable')
    expect(within(screen.getByTestId('hermes-project-project-empty')).queryByTestId(/project-location-badge/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('clients/private/project')
    expect(document.body).not.toHaveTextContent('/Users/peet/private/project')
  })

  it('links mapped catalogue locations and unlinks replicas without changing project sessions', async () => {
    let workspaceRequests = 0
    let locationReads = 0
    const locationPosts: Record<string, unknown>[] = []
    const locationDeletes: string[] = []
    const projectConversation = {
      ...baseConversation,
      id: 'conv-project',
      title: 'Immutable launch session',
      scope: 'project' as const,
      scopeRefId: 'project-1',
      contextRefs: [projectRef],
    }
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) {
        workspaceRequests += 1
        return jsonResponse({ data: {
          workspaces: [{ workspaceId: 'acme', orgId: 'org-1', orgSlug: 'acme', orgName: 'Acme', agentDomain: 'acme', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: 'runtime-mac', folderVersion: 1 }],
          runtimeTargetsByWorkspace: { acme: [{
            id: 'runtime-mac', label: 'Studio Mac', locationId: 'location-mac', mappingId: 'mapping-mac', workspaceId: 'acme',
            selectable: true, enabled: true, isLocal: true, isFresh: true, isHealthy: true, lastSeenAt: null,
            privatePath: '/Users/peet/private/mac',
          }, {
            id: 'runtime-vps', label: 'Client VPS', locationId: 'location-vps', workspaceId: 'acme',
            selectable: true, enabled: true, isLocal: false, isFresh: true, isHealthy: true, lastSeenAt: null,
            serverPath: '/srv/private/client',
          }, {
            id: 'runtime-offline', label: 'Offline PC', locationId: 'location-offline', workspaceId: 'acme',
            selectable: false, enabled: true, isLocal: true, isFresh: false, isHealthy: false, lastSeenAt: null,
          }] },
          projects: [{ id: 'project-1', name: 'Launch Project' }],
        } })
      }
      if (url === '/api/v1/projects/project-1/locations?orgId=org-1' && (!init?.method || init.method === 'GET')) {
        locationReads += 1
        const added = locationReads > 1 ? [{
          replicaId: 'replica-mac', locationId: 'location-mac', locationLabel: 'Studio Mac',
          availability: 'online', syncStatus: 'pending', locationVisibility: 'organization', active: true,
        }, {
          replicaId: 'replica-vps', locationId: 'location-vps', locationLabel: 'Client VPS',
          availability: 'online', syncStatus: 'pending', locationVisibility: 'organization', active: true,
        }] : []
        const archive = locationDeletes.length === 0 ? [{
          replicaId: 'replica-archive', locationId: 'location-archive', locationLabel: 'Archive PC',
          availability: 'offline', syncStatus: 'offline', locationVisibility: 'private', authenticatedRuntime: true, active: true,
          relativePath: 'projects/private/archive',
        }] : []
        return jsonResponse({ data: { locations: [...archive, ...added] } })
      }
      if (url === '/api/v1/projects/project-1/locations' && init?.method === 'POST') {
        locationPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return jsonResponse({ data: { replica: { replicaId: `replica-${locationPosts.length}`, syncStatus: 'pending' } } })
      }
      if (url.startsWith('/api/v1/projects/project-1/locations/') && init?.method === 'DELETE') {
        locationDeletes.push(url)
        return jsonResponse({ data: { replica: { active: false } } })
      }
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [projectConversation] } })
      if (url === '/api/v1/conversations/conv-project/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)
    const project = await screen.findByTestId('hermes-project-project-1')
    expect(within(project).queryByTestId(/project-location-badge/)).not.toBeInTheDocument()
    fireEvent.click(within(project).getByRole('button', { name: 'Manage locations for Launch Project' }))

    const manager = await within(project).findByRole('region', { name: 'Manage locations for Launch Project' })
    expect(await within(manager).findByText('Archive PC · Computer unavailable')).toBeInTheDocument()
    expect(within(manager).getByText('Private')).toBeInTheDocument()
    expect(within(manager).getByRole('checkbox', { name: 'Studio Mac · online' })).toBeEnabled()
    expect(within(manager).getByRole('checkbox', { name: 'Client VPS · online' })).toBeEnabled()
    expect(within(manager).getByRole('checkbox', { name: 'Offline PC · Computer unavailable' })).toBeDisabled()
    expect(within(manager).queryByText('/Users/peet/private/mac')).not.toBeInTheDocument()
    expect(within(manager).queryByText('/srv/private/client')).not.toBeInTheDocument()
    expect(within(manager).queryByText('projects/private/archive')).not.toBeInTheDocument()

    fireEvent.click(within(manager).getByRole('checkbox', { name: 'Studio Mac · online' }))
    fireEvent.click(within(manager).getByRole('checkbox', { name: 'Client VPS · online' }))
    fireEvent.click(within(manager).getByRole('button', { name: 'Link selected locations' }))
    await waitFor(() => expect(locationPosts).toEqual([{
      orgId: 'org-1', workspaceId: 'acme', locationId: 'location-mac', mappingId: 'mapping-mac',
    }, {
      orgId: 'org-1', workspaceId: 'acme', locationId: 'location-vps',
    }]))
    await waitFor(() => expect(workspaceRequests).toBeGreaterThanOrEqual(2))
    expect(within(project).getByTestId('conversation-row-conv-project')).toHaveTextContent('Immutable launch session')

    fireEvent.click(await within(manager).findByRole('button', { name: 'Unlink Archive PC' }))
    await waitFor(() => expect(locationDeletes).toEqual([
      '/api/v1/projects/project-1/locations/replica-archive?orgId=org-1',
    ]))
    await waitFor(() => expect(workspaceRequests).toBeGreaterThanOrEqual(3))
    expect(within(project).getByTestId('conversation-row-conv-project')).toHaveTextContent('Immutable launch session')
  })

  it('explains organisation sharing and mapping when a project has no eligible location candidates', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: {
        workspaces: [{ workspaceId: 'client', orgId: 'org-1', orgSlug: 'client', orgName: 'Client', agentDomain: 'client', sourceOfTruth: 'vps', syncMode: 'hybrid', defaultRuntimeTarget: '', folderVersion: 1 }],
        runtimeTargetsByWorkspace: { client: [{ id: 'unmapped-device', label: 'Unmapped Mac', selectable: true }] },
        projects: [{ id: 'project-client', name: 'New client project' }],
      } })
      if (url === '/api/v1/projects/project-client/locations?orgId=org-1') return jsonResponse({ data: { locations: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)
    const project = await screen.findByTestId('hermes-project-project-client')
    fireEvent.click(within(project).getByRole('button', { name: 'Manage locations for New client project' }))
    const manager = await within(project).findByRole('region', { name: 'Manage locations for New client project' })

    expect(await within(manager).findByText(/must first be shared with and mapped to this organisation/i)).toBeInTheDocument()
    expect(within(manager).getByRole('button', { name: 'Link selected locations' })).toBeDisabled()
  })

  it('filters non-project Hermes sessions while showing their compact context glyph', async () => {
    const studioRef: ContextReference = {
      type: 'studio',
      id: 'marketing:org-1',
      orgId: 'org-1',
      label: 'Marketing Studio',
      origin: 'mention',
    }
    const conversations = [
      { ...baseConversation, id: 'conv-studio', title: 'Campaign review', contextRefs: [studioRef] },
      { ...baseConversation, id: 'conv-general', title: 'General catch-up', contextRefs: [] },
    ]
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      if (url.startsWith('/api/v1/chat-context/')) return jsonResponse({ data: {
        context: { kind: 'studio', id: studioRef.id, orgId: 'org-1', label: 'Marketing Studio', icon: 'draw' },
        pulse: { label: 'Marketing Studio', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T10:00:00.000Z',
      } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)

    const search = await screen.findByRole('searchbox', { name: 'Filter conversations' })
    expect(await screen.findByTestId('conversation-row-conv-studio')).toHaveTextContent('Campaign review')
    expect(screen.getByTestId('conversation-row-conv-studio')).toHaveClass('focus-visible:ring-2')
    expect(within(screen.getByTestId('conversation-row-conv-studio')).getByTitle('Context: Marketing Studio')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Marketing Studio|Projects|CRM/i })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'general' } })
    expect(screen.queryByTestId('conversation-row-conv-studio')).not.toBeInTheDocument()
    expect(screen.getByTestId('conversation-row-conv-general')).toBeInTheDocument()
  })

  it('pins and unpins Hermes sessions from the conversation menu as a local preference', async () => {
    window.localStorage.removeItem('pib.messages.pinnedConversations.v1:org-1')
    const conversations = [
      {
        ...baseConversation,
        id: 'conv-project',
        title: 'Website project',
        scope: 'project',
        contextRefs: [projectRef],
        lastMessagePreview: 'Project thread',
        lastMessageAt: { seconds: 9 },
      },
      {
        ...baseConversation,
        id: 'conv-recent',
        title: 'General inbox',
        participants: [{ kind: 'user' as const, uid: 'client-1', role: 'client' as const, displayName: 'Client One' }],
        participantAgentIds: [],
        lastMessagePreview: 'Recent thread',
        lastMessageAt: { seconds: 7 },
      },
    ]

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations } })
      if (url.includes('/messages')) return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        layoutVariant="hermes"
      />,
    )

    await screen.findByTestId('hermes-session-section-recent')
    fireEvent.click(screen.getByLabelText('Conversation options for General inbox'))
    fireEvent.click(screen.getByText('Pin session'))

    expect(await screen.findByTestId('hermes-session-section-pinned')).toHaveTextContent('General inbox')
    expect(window.localStorage.getItem('pib.messages.pinnedConversations.v1:org-1')).toContain('conv-recent')

    fireEvent.click(screen.getByLabelText('Conversation options for General inbox'))
    fireEvent.click(screen.getByText('Unpin session'))

    await waitFor(() => expect(screen.queryByTestId('hermes-session-section-pinned')).not.toBeInTheDocument())
    expect(screen.getByTestId('hermes-session-section-recent')).toHaveTextContent('General inbox')
    expect(window.localStorage.getItem('pib.messages.pinnedConversations.v1:org-1')).toBeNull()
  })

  it('keeps idle Hermes chat on the two-column grid without a competing runtime rail', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        layoutVariant="hermes"
      />,
    )

    await screen.findByText('Latest message')

    expect(screen.getByTestId('hermes-runtime-control-bar')).toHaveTextContent('0 queued')
    expect(screen.getByLabelText('Runtime thinking effort')).toBeInTheDocument()
    expect(screen.queryByTestId('runtime-inspector-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hermes-runtime-inspector-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('unified-chat-root')).not.toHaveClass('xl:grid-cols-[236px_minmax(0,1fr)_260px]')
  })

  it('opens active execution in the shared context dock instead of a third rail', async () => {
    const defaultFetch = global.fetch as jest.Mock
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [{
        id: 'msg-run', conversationId: 'conv-1', role: 'assistant', content: 'Working', authorKind: 'agent',
        authorId: 'pip', authorDisplayName: 'Pip', status: 'failed', runId: 'run-live', createdAt: '2026-06-08T09:05:00.000Z',
        uiActions: [{ id: 'retry-run', type: 'retry', label: 'Retry' }],
      }] } })
      if (String(input) === '/api/v1/admin/agents/pip/runs/run-live/actions') return errorResponse(500, { error: 'retry unavailable' })
      return defaultFetch(input, init)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" initialConvId="conv-1" />)
    await screen.findByText('Working')
    expect(screen.getByRole('button', { name: 'Add conversation context' })).toBeInTheDocument()
    expect(screen.queryByTestId('runtime-inspector-rail')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('hermes-runtime-inspector-toggle'))
    expect(screen.getByRole('dialog', { name: 'Conversation context' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Execution' })).toHaveAttribute('data-emphasized', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Retry run' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/agents/pip/runs/run-live/actions', expect.objectContaining({ method: 'POST' })))
  })

  it('opens execution in the same modal sheet used by compact Briefings chat', async () => {
    const originalMatchMedia = window.matchMedia
    const matchMedia = jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }))
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
    const defaultFetch = global.fetch as jest.Mock
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/conversations/conv-1/messages') return jsonResponse({ data: { messages: [{
        id: 'msg-run-compact', conversationId: 'conv-1', role: 'assistant', content: 'Compact run', authorKind: 'agent',
        authorId: 'pip', authorDisplayName: 'Pip', status: 'waiting_approval', runId: 'run-compact', createdAt: '2026-06-08T09:05:00.000Z',
      }] } })
      return defaultFetch(input, init)
    })

    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" compact initialConvId="conv-1" />)
    await screen.findByText('Compact run')
    fireEvent.click(screen.getByTestId('execution-context-trigger'))
    const sheet = screen.getByRole('dialog', { name: 'Conversation context' })
    expect(sheet).toHaveAttribute('data-presentation', 'sheet')
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('region', { name: 'Execution' })).toBeInTheDocument()
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 1023px)')
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  })
})

describe('UnifiedChat context references', () => {
  let mockFetch: jest.Mock
  let conversation: typeof baseConversation

  beforeEach(() => {
    conversation = { ...baseConversation, contextRefs: [] }
    mockFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({
          data: [
            {
              agentId: 'pip',
              name: 'Pip',
              role: 'Operator',
              persona: 'Routes work',
              iconKey: 'robot_2',
              colorKey: 'violet',
              enabled: true,
              baseUrl: 'https://agent.example.com',
              defaultModel: 'gpt-5',
              skills: ['partnersinbiz/client-manager'],
              skillPolicy: {
                runtimeSkills: ['content-engine', 'social-media-manager'],
                pibSkills: ['content-engine', 'social-media-manager'],
                globalSkills: ['google-workspace'],
                capabilities: ['read', 'draft', 'write'],
                approvalGates: ['publish'],
              },
            },
          ],
        })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        if (init?.method === 'POST') {
          return jsonResponse({
            data: {
              message: {
                id: 'msg-1',
                conversationId: 'conv-1',
                role: 'user',
                content: 'What next?',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
              },
            },
          }, true)
        }
        return jsonResponse({ data: { messages: [] } })
      }
      if (url === '/api/v1/conversations/conv-1/context') {
        const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        const nextRef = parsedBody.refs?.[0]?.type === 'project' ? projectRef : contactRef
        conversation = { ...conversation, contextRefs: [nextRef] }
        return jsonResponse({ data: { contextRefs: [nextRef] } })
      }
      if (url.startsWith('/api/v1/context-references/search')) {
        return jsonResponse({ data: { refs: [projectRef] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    global.fetch = mockFetch
  })

  it('keeps an accessible Add context strip available before the first reference is pinned', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    const addContext = screen.getByRole('button', { name: 'Add conversation context' })

    expect(addContext).toHaveClass('h-11', 'min-w-11', 'focus-visible:ring-2')
    expect(addContext.closest('[role="toolbar"]')).toHaveAttribute('aria-label', 'Pinned conversation context')

    fireEvent.click(addContext)

    expect(input).toHaveValue('@')
    await waitFor(() => expect(input).toHaveFocus())
    expect(await screen.findByRole('button', { name: 'Use @projects:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @docs:' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use @projects:' }))
    await act(async () => {
      fireEvent.change(input, { target: { value: '@projects:launch' } })
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(await screen.findByText('Launch Project'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Launch Project context' })).toBeInTheDocument())
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/context', expect.objectContaining({ method: 'PATCH' }))
    expect(screen.getByRole('button', { name: 'Add conversation context' })).toBeInTheDocument()
  })

  it('reuses an open context picker without changing the draft or appending another mention', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    const addContext = screen.getByRole('button', { name: 'Add conversation context' })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })

    fireEvent.click(addContext)
    expect(input).toHaveValue('Keep this draft @')
    expect(await screen.findByRole('button', { name: 'Use @projects:' })).toBeInTheDocument()

    fireEvent.click(addContext)
    expect(input).toHaveValue('Keep this draft @')
    await waitFor(() => expect(input).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Use @projects:' }))
    fireEvent.change(input, { target: { value: 'Keep this draft @projects:lau' } })
    fireEvent.click(addContext)

    expect(input).toHaveValue('Keep this draft @projects:lau')
    await waitFor(() => expect(input).toHaveFocus())

    fireEvent.click(await screen.findByText('Launch Project'))
    await waitFor(() => expect(input).toHaveValue('Keep this draft'))
  })

  it('does not add a separator when the draft already ends in whitespace', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: 'Keep this line\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add conversation context' }))

    expect(input).toHaveValue('Keep this line\n@')
  })

  it('pins the detected current page from the drawer action', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    await screen.findByPlaceholderText('Send a message')
    fireEvent.click(await screen.findByRole('button', { name: /Use current page/ }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/context', expect.objectContaining({
      method: 'PATCH',
    }))
  })

  it('places thinking effort beside the current-page control instead of inside the input pill', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    await screen.findByPlaceholderText('Send a message')

    const contextToolbar = screen.getByTestId('chat-context-toolbar')
    const currentPageButton = screen.getByRole('button', { name: /Use current page/ })
    const thinkingEffort = screen.getByLabelText('Thinking effort')
    const inputPill = screen.getByTestId('chat-input-pill')

    expect(contextToolbar).toContainElement(currentPageButton)
    expect(contextToolbar).toContainElement(thinkingEffort)
    expect(inputPill).not.toContainElement(thinkingEffort)
  })

  it('treats the exact current-page phrase as a pin-only command', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: 'use current page as context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    const messagePosts = mockFetch.mock.calls.filter(([url, init]) =>
      String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
    )
    expect(messagePosts).toHaveLength(0)
  })

  it('searches and attaches namespaced @references', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'company',
          id: 'company-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/portal/companies/company-1',
        }}
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Compare @projects:launch' } })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByText('Launch Project'))

    await waitFor(() => expect(screen.getByTitle('project: Launch Project')).toBeInTheDocument())
    expect(input).toHaveValue('Compare')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('contextType=company'),
      expect.anything(),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('contextId=company-1'),
      expect.anything(),
    )
  })

  it('shows reference type options for bare @ input', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '@' } })

    expect(await screen.findByRole('button', { name: 'Use @projects:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @contacts:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @tasks:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @businesses:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use @products:' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use @products:' }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(input).toHaveValue('@products:')
  })

  it('shows slash commands and sends structured command metadata', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '/' } })

    expect(await screen.findByRole('button', { name: 'Use /task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use /route' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use /council' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use /task' }))
    expect(input).toHaveValue('/task ')

    fireEvent.change(input, { target: { value: '/task Follow up with Theo about slash commands' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('Follow up with Theo about slash commands')
      expect(body.slashCommand).toMatchObject({
        id: 'task',
        token: '/task',
        executorKind: 'agent_intent',
        args: 'Follow up with Theo about slash commands',
      })
    })
  })

  it('sends /council as structured command metadata', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '/council Should we launch the new workflow this week?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('Should we launch the new workflow this week?')
      expect(body.slashCommand).toMatchObject({
        id: 'council',
        token: '/council',
        executorKind: 'agent_intent',
        args: 'Should we launch the new workflow this week?',
      })
    })
  })

  it('shows selected agent skills and exposes /skills as structured command intent', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    expect(await screen.findByRole('button', { name: 'Show Pip skills' })).toBeInTheDocument()
    expect(screen.getByText('content-engine')).toBeInTheDocument()
    expect(screen.getByText('social-media-manager')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '/sk' } })
    expect(await screen.findByRole('button', { name: 'Use /skills' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use /skills' }))
    expect(input).toHaveValue('/skills ')

    fireEvent.change(input, { target: { value: '/skills content campaigns' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      const body = JSON.parse(messagePost![1].body as string)
      expect(body.content).toBe('content campaigns')
      expect(body.slashCommand).toMatchObject({
        id: 'skills',
        token: '/skills',
        executorKind: 'agent_intent',
        args: 'content campaigns',
      })
    })
  })

  it('treats /use-current-page as a structured pin-only command with no message send', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        currentPageContext={{
          type: 'contact',
          id: 'contact-1',
          orgId: 'org-1',
          origin: 'current_page',
          href: '/admin/crm/contacts/contact-1',
        }}
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.change(input, { target: { value: '/use-current-page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByTitle('contact: Jane Client')).toBeInTheDocument())
    const messagePosts = mockFetch.mock.calls.filter(([url, init]) =>
      String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
    )
    expect(messagePosts).toHaveLength(0)
  })

  it('queues follow-up prompts instead of dispatching while an agent run is active', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [conversation] } })
      if (url === '/api/v1/conversations/conv-1/messages') {
        if (init?.method === 'POST') {
          throw new Error('Queued prompts must not dispatch while a run is active')
        }
        return jsonResponse({
          data: {
            messages: [{
              id: 'msg-waiting',
              conversationId: 'conv-1',
              role: 'assistant',
              content: 'Waiting for approval',
              authorKind: 'agent',
              authorId: 'pip',
              authorDisplayName: 'Pip',
              status: 'waiting_approval',
              createdAt: { seconds: 2 },
            }],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    const input = await screen.findByPlaceholderText('Queue a follow-up while Pip is running')
    fireEvent.change(input, { target: { value: 'Please continue after approval' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByTestId('queued-composer-drafts')).toHaveTextContent('1 queued follow-up')
    expect(screen.getByText('Please continue after approval')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(mockFetch.mock.calls.some(([url, init]) =>
      String(url) === '/api/v1/conversations/conv-1/messages' && init?.method === 'POST',
    )).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    expect(input).toHaveValue('Please continue after approval')
    expect(screen.queryByTestId('queued-composer-drafts')).not.toBeInTheDocument()
  })

  it('recalls local composer history with ArrowUp and ArrowDown', async () => {
    window.localStorage.setItem(
      'pib.messages.composerHistory.v1:org-1:conv-1',
      JSON.stringify(['First saved prompt', 'Second saved prompt']),
    )

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    const input = await screen.findByPlaceholderText('Send a message')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('Second saved prompt')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('First saved prompt')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('Second saved prompt')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('')
  })

  it('allows attaching a file before an auto-created agent conversation exists', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [] } })
      }
      if (url === '/api/v1/conversations' && init?.method === 'POST') {
        return jsonResponse({
          data: {
            conversation: {
              ...baseConversation,
              id: 'conv-created',
              title: 'Attachment conversation',
            },
          },
        })
      }
      if (url === '/api/v1/conversations/conv-created/attachments' && init?.method === 'POST') {
        return jsonResponse({
          data: {
            id: 'file-1',
            name: 'brief.pdf',
            url: 'https://files.example.com/brief.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
          },
        })
      }
      if (url === '/api/v1/conversations/conv-created/messages') {
        if (init?.method === 'POST') {
          return jsonResponse({
            data: {
              message: {
                id: 'msg-1',
                conversationId: 'conv-created',
                role: 'user',
                content: 'Please review\n\nAttachment: brief.pdf (1.0 KB)',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
              },
            },
          })
        }
        return jsonResponse({ data: { messages: [] } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const { container } = render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    const input = await screen.findByPlaceholderText('Message Pip')
    const attachButton = screen.getByRole('button', { name: 'Attach file' })
    expect(attachButton).not.toBeDisabled()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('brief.pdf')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Please review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations', expect.objectContaining({ method: 'POST' }))
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-created/attachments', expect.objectContaining({ method: 'POST' }))
      const messagePost = mockFetch.mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/conversations/conv-created/messages' && init?.method === 'POST',
      )
      expect(messagePost).toBeTruthy()
      expect(JSON.parse(messagePost![1].body as string)).toMatchObject({
        content: 'Please review\n\nAttachment: brief.pdf (1.0 KB)',
        attachments: [{ id: 'file-1', name: 'brief.pdf' }],
      })
    })
  })

  it('seeds the exact preferred context when the first send creates a conversation', async () => {
    const studioRef = { type: 'studio_artifact' as const, id: 'youtube_studio:video:video-1', orgId: 'org-1', label: 'Launch film' }
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      if (url === '/api/v1/conversations' && init?.method === 'POST') return jsonResponse({ data: { conversation: { ...baseConversation, id: 'conv-studio', contextRefs: [studioRef] } } })
      if (url === '/api/v1/conversations/conv-studio/messages' && init?.method === 'POST') return jsonResponse({ data: { message: { id: 'm1', conversationId: 'conv-studio', role: 'user', content: 'Review it', status: 'completed' } } })
      if (url === '/api/v1/conversations/conv-studio/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" currentPageContext={studioRef} preferCurrentPageContext />)
    const input = await screen.findByPlaceholderText('Message Pip')
    fireEvent.change(input, { target: { value: 'Review it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => {
      const create = mockFetch.mock.calls.find(([url, init]) => String(url) === '/api/v1/conversations' && init?.method === 'POST')
      expect(JSON.parse(create![1].body as string)).toMatchObject({ contextRefs: [studioRef] })
    })
  })

  it('uses only the latest preferred context after a fast card switch before first send', async () => {
    const firstRef = { type: 'studio_artifact' as const, id: 'youtube_studio:video:first', orgId: 'org-1', label: 'First film' }
    const latestRef = { type: 'studio_artifact' as const, id: 'youtube_studio:video:latest', orgId: 'org-1', label: 'Latest film' }
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
      if (url === '/api/v1/conversations' && init?.method === 'POST') return jsonResponse({ data: { conversation: { ...baseConversation, id: 'conv-latest', contextRefs: [latestRef] } } })
      if (url === '/api/v1/conversations/conv-latest/messages' && init?.method === 'POST') return jsonResponse({ data: { message: { id: 'm1', conversationId: 'conv-latest', role: 'user', content: 'Use latest', status: 'completed' } } })
      if (url === '/api/v1/conversations/conv-latest/messages') return jsonResponse({ data: { messages: [] } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    const { rerender } = render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" currentPageContext={firstRef} preferCurrentPageContext />)
    await screen.findByPlaceholderText('Message Pip')
    rerender(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" currentPageContext={latestRef} preferCurrentPageContext />)
    const input = await screen.findByPlaceholderText('Message Pip')
    fireEvent.change(input, { target: { value: 'Use latest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => {
      const create = mockFetch.mock.calls.find(([url, init]) => String(url) === '/api/v1/conversations' && init?.method === 'POST')
      const body = JSON.parse(create![1].body as string)
      expect(body.contextRefs).toEqual([expect.objectContaining(latestRef)])
      expect(body.contextRefs).not.toContainEqual(expect.objectContaining(firstRef))
    })
  })

  it('opens the permitted conversation carrying the exact preferred context', async () => {
    const studioRef = { type: 'studio' as const, id: 'youtube_studio:org-1', orgId: 'org-1', label: 'YouTube Studio' }
    const unrelated = { ...baseConversation, id: 'conv-other', title: 'General operations', contextRefs: [] }
    const related = { ...baseConversation, id: 'conv-related', title: 'YouTube launch', contextRefs: [studioRef] }
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [unrelated, related] } })
      if (url === '/api/v1/conversations/conv-related/messages') return jsonResponse({ data: { messages: [] } })
      if (url.includes('/api/v1/chat-context/studio/')) return jsonResponse({ data: { context: { kind: 'studio', id: studioRef.id, orgId: 'org-1', label: 'YouTube Studio', icon: 'video' }, pulse: { label: 'YouTube Studio', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' } })
      throw new Error(`Unhandled fetch: ${url}`)
    })
    render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" currentPageContext={studioRef} preferCurrentPageContext />)
    expect((await screen.findAllByText('YouTube launch')).length).toBeGreaterThan(0)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-related/messages'))
    expect(mockFetch).not.toHaveBeenCalledWith('/api/v1/conversations/conv-other/messages')
  })

  it('accepts dropped image files into the existing attachment preview before send', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    await screen.findByPlaceholderText('Send a message')
    const dropZone = screen.getByTestId('chat-input-drop-zone')
    const image = new File(['image'], 'wireframe.png', { type: 'image/png' })

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [image],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    })

    expect(await screen.findByText('wireframe.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled()
  })

  it('rejects unsupported dropped files before they enter the attachment preview', async () => {
    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
      />,
    )

    await screen.findByPlaceholderText('Send a message')
    const dropZone = screen.getByTestId('chat-input-drop-zone')
    const script = new File(['alert(1)'], 'payload.js', { type: 'application/javascript' })

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [script],
        items: [{ kind: 'file', type: 'application/javascript' }],
      },
    })

    expect(screen.queryByText('payload.js')).not.toBeInTheDocument()
    expect(await screen.findByText('Unsupported file type: payload.js')).toBeInTheDocument()
  })

  it('keeps loaded messages in a scrollable log and scrolls to the latest message', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('role') === 'log' ? 1200 : 0
      },
    })

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-1',
                conversationId: 'conv-1',
                role: 'user',
                content: 'Earlier note',
                authorKind: 'user',
                authorId: 'user-1',
                authorDisplayName: 'Peet',
                status: 'completed',
                createdAt: { seconds: 1 },
              },
              {
                id: 'msg-2',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Latest reply',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                createdAt: { seconds: 2 },
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    const messageLog = await screen.findByRole('log', { name: 'Conversation messages' })
    await screen.findByText('Latest reply')

    await waitFor(() => {
      expect(messageLog.scrollTop).toBe(1200)
    })
  })

  it('falls back to chat-feed when the focused conversation messages route returns 401', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return errorResponse(401)
      }
      if (url === '/api/v1/chat-feed/conv-1') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-digest',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'CEO dynamic approval digest posted.',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                richParts: [
                  {
                    type: 'approval_card',
                    title: 'Release: dynamic chat and gatherer routes',
                    body: 'Approve release review before production deployment.',
                    status: 'awaiting-input',
                  },
                ],
                createdAt: { seconds: 2 },
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    expect(await screen.findByText('CEO dynamic approval digest posted.')).toBeInTheDocument()
    expect(await screen.findByText('Release: dynamic chat and gatherer routes')).toBeInTheDocument()
    expect(screen.getByText('Approve release review before production deployment.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/chat-feed/conv-1')
  })

  it('falls back to thread-data when browser filters block messages and chat-feed routes', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [conversation] } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        throw new TypeError('Failed to fetch')
      }
      if (url === '/api/v1/chat-feed/conv-1') {
        throw new TypeError('Failed to fetch')
      }
      if (url === '/api/v1/thread-data/conv-1') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-thread-data',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Newest CEO dynamic relay is readable.',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                richParts: [
                  {
                    type: 'approval_card',
                    title: 'Dynamic Messages live-render proof',
                    body: 'The thread-data fallback rendered the newest relay.',
                    statusLabel: 'Verified',
                  },
                ],
                createdAt: { seconds: 2 },
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    expect(await screen.findByText('Newest CEO dynamic relay is readable.')).toBeInTheDocument()
    expect(await screen.findByText('Dynamic Messages live-render proof')).toBeInTheDocument()
    expect(screen.getByText('The thread-data fallback rendered the newest relay.')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/thread-data/conv-1')
  })

  it('loads a focused conversation directly when scoped conversation list does not include it', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
      if (url.includes('/visible-agents')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
      if (url.startsWith('/api/v1/conversations?')) {
        return jsonResponse({ data: { conversations: [] } })
      }
      if (url === '/api/v1/conversations/conv-1') {
        return jsonResponse({ data: { conversation } })
      }
      if (url === '/api/v1/conversations/conv-1/messages') {
        return jsonResponse({
          data: {
            messages: [
              {
                id: 'msg-browser-proof',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Signed-in Chrome verification completed.',
                authorKind: 'agent',
                authorId: 'pip',
                authorDisplayName: 'Pip',
                status: 'completed',
                createdAt: { seconds: 3 },
              },
            ],
          },
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <UnifiedChat
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
      />,
    )

    expect(await screen.findAllByText('Launch chat')).toHaveLength(2)
    expect(await screen.findByText('Signed-in Chrome verification completed.')).toBeInTheDocument()
    expect(screen.queryByText('No conversations yet. Start one.')).not.toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/conversations/conv-1')
  })
})
