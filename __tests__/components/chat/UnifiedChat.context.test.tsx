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
    fireEvent.click(await screen.findByRole('button', { name: /new conversation/i }))

    const dialog = screen.getByRole('dialog', { name: 'New conversation' })
    expect(dialog).toHaveClass('max-h-[100dvh]', 'flex-col', 'overflow-hidden')
    expect(screen.getByTestId('new-conversation-scroll-body')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(screen.getByRole('button', { name: 'Start conversation' }).parentElement).toHaveClass('shrink-0')
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
    const workspaceContextOption = screen.getByRole('option', { name: 'Organisation Workspace folder' })
    fireEvent.change(workspaceContextOption.parentElement as HTMLSelectElement, { target: { value: 'workspace' } })

    expect(await screen.findByText(/VPS-canonical organisation Workspace/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Acme Mac · online' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beta PC/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/\/var\/lib\/hermes/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/~\/Cowork/i)).not.toBeInTheDocument()
  })

  it('keeps an unavailable explicit target visible as an error and never falls back', async () => {
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Studio Mac is unavailable. Select another computer or try again when it is online.')
    expect(screen.getByRole('alert')).toHaveTextContent('No other runtime was selected.')
    expect(screen.queryByText(/Office PC was selected/i)).not.toBeInTheDocument()
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
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
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
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
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

  it('groups Hermes sessions into pinned, projects, agents, and recent without changing the classic rail', async () => {
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
      if (url.startsWith('/api/v1/workspaces?')) return jsonResponse({ data: { workspaces: [] } })
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
    expect(within(screen.getByTestId('hermes-session-section-projects')).getByText('Website project')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-agents')).getByText('Pip agent run')).toBeInTheDocument()
    expect(within(screen.getByTestId('hermes-session-section-recent')).getByText('General inbox')).toBeInTheDocument()
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

  it('keeps the Hermes left rail conversation-only while filtering sessions and showing one compact context glyph', async () => {
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
