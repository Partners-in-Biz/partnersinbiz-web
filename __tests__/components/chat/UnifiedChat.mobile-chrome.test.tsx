import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import type { ContextReference } from '@/lib/context-references/types'
import { isHiddenUntilMd } from '@/lib/messages/mobile-conversation-chrome'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

const projectRef: ContextReference = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Hunt & Gun — Seller CRM',
  origin: 'mention',
}

const conversation = {
  id: 'conv-1',
  orgId: 'org-1',
  participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
  participantUids: ['user-1'],
  participantAgentIds: ['pip'],
  startedBy: 'user-1',
  title: 'VP - H&G - CRM',
  messageCount: 1,
  archived: false,
  scope: 'project' as const,
  scopeRefId: 'project-1',
  commandSessionProjectId: 'project-1',
  contextRefs: [projectRef],
  workspaceContext: {
    workspaceId: 'acme',
    orgName: 'Partners in Biz',
    runtimeTarget: 'hermes-vps-01',
    runtimeLabel: 'hermes-vps-01',
    projectName: 'Hunt & Gun — Seller CRM',
  },
}

const modelCatalogResponse = {
  data: {
    agentId: 'pip',
    canSelect: true,
    currentModel: 'anthropic/claude-fable-5',
    currentProvider: 'anthropic',
    autoModel: 'anthropic/claude-fable-5',
    autoProvider: 'anthropic',
    autoLabel: 'Auto',
    source: 'hermes',
    providers: [{ id: 'anthropic', label: 'Anthropic', configured: true, active: true }],
    models: [{
      id: 'anthropic/claude-fable-5',
      model: 'anthropic/claude-fable-5',
      displayName: 'Claude Fable 5',
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      configured: true,
      active: true,
      available: true,
      source: 'hermes',
    }],
  },
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

function installViewport(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string) => ({
      matches: query.includes('max-width: 767px')
        ? width <= 767
        : query.includes('max-width: 1279px')
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

function installFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/models?')) return jsonResponse(modelCatalogResponse)
    if (url.includes('/visible-agents') || url.includes('/contacts')) return jsonResponse({ data: [] })
    if (url.startsWith('/api/v1/workspaces?')) {
      return jsonResponse({
        data: {
          workspaces: [{
            workspaceId: 'acme',
            orgId: 'org-1',
            orgSlug: 'acme',
            orgName: 'Partners in Biz',
            agentDomain: 'acme',
            sourceOfTruth: 'vps',
            syncMode: 'hybrid',
            defaultRuntimeTarget: 'hermes-vps-01',
            folderVersion: 1,
          }],
          runtimeTargetsByWorkspace: {
            acme: [{
              id: 'hermes-vps-01',
              label: 'hermes-vps-01',
              kind: 'vps',
              deviceKind: 'vps',
              selectable: true,
              enabled: true,
              isFresh: true,
              isHealthy: true,
              lastSeenAt: '2026-08-28T18:00:00.000Z',
            }],
          },
          projects: [{ id: 'project-1', name: 'Hunt & Gun — Seller CRM' }],
        },
      })
    }
    if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [conversation] } })
    if (url.includes('/conversations/conv-1/messages')) {
      return jsonResponse({
        data: {
          messages: [{
            id: 'msg-1',
            conversationId: 'conv-1',
            role: 'assistant',
            content: 'Latest message',
            authorKind: 'agent',
            authorId: 'pip',
            authorDisplayName: 'Pip',
            status: 'completed',
            createdAt: '2026-08-28T18:00:00.000Z',
          }],
        },
      })
    }
    if (url.startsWith('/api/v1/chat-context/')) {
      return jsonResponse({
        data: {
          context: { kind: 'project', id: 'project-1', orgId: 'org-1', label: 'Hunt & Gun — Seller CRM', icon: 'target' },
          pulse: { label: 'Project', metrics: [] },
          groups: [],
          artifacts: [],
          attention: [],
          activity: [],
          capabilities: [],
          asOf: '2026-08-28T18:00:00.000Z',
        },
      })
    }
    if (url === '/api/v1/projects/project-1/chat-progress') {
      return jsonResponse({ data: { project: { id: 'project-1', name: 'Hunt & Gun — Seller CRM' }, tasks: [] } })
    }
    if (url.startsWith('/api/v1/orgs/org-1/bots')) return jsonResponse({ data: { devices: [], canCreate: false } })
    return jsonResponse({ data: {} })
  })
}

function renderMessages(experienceMode: 'bot' | 'messages' = 'bot') {
  return render(
    <UnifiedChat
      orgId="org-1"
      orgName="Partners in Biz"
      currentUserUid="user-1"
      currentUserDisplayName="Peet"
      initialConvId="conv-1"
      layoutVariant="hermes"
      showAgentWorkbench
      experienceMode={experienceMode}
      onExperienceModeChange={jest.fn()}
      allowArchiveConversations
      allowDeleteConversations
      allowManageConversationAccess
    />,
  )
}

function firstPaintContextHost() {
  return screen.queryByTestId('context-pulse') ?? screen.getByTestId('conversation-context-strip')
}

describe('UnifiedChat mobile conversation first paint', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  })

  it('hides phone chrome with CSS on the default tree before matchMedia, not by unmounting after JS', async () => {
    installFetch()
    renderMessages('bot')

    await waitFor(() => expect(screen.getByTestId('conversation-title')).toHaveTextContent('VP - H&G - CRM'))
    await waitFor(() => expect(screen.getByTestId('conversation-command-session')).toBeInTheDocument())
    await waitFor(() => {
      expect(screen.queryByTestId('context-pulse') ?? screen.queryByTestId('conversation-context-strip')).toBeTruthy()
    })

    const hosts = [
      screen.getByTestId('conversation-command-session'),
      screen.getByTestId('conversation-mobile-subtitle'),
      screen.getByTestId('bot-computer-strip'),
      firstPaintContextHost(),
      screen.getByTestId('hermes-runtime-control-bar'),
      screen.getByTestId('conversation-design-commands'),
    ]
    for (const host of hosts) {
      expect(isHiddenUntilMd(host.className)).toBe(true)
    }

    const closedRail = screen.queryByTestId('agent-workbench-rail')
    if (closedRail?.getAttribute('data-open') === 'false') {
      expect(isHiddenUntilMd(closedRail.className)).toBe(true)
    }

    expect(screen.getByLabelText('Attach file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.getByTestId('chat-input-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('conversation-overflow-sheet')).not.toBeInTheDocument()
  })

  it('keeps sandwich chrome CSS-hidden on a phone and still reaches it from overflow', async () => {
    installViewport(390)
    installFetch()
    renderMessages('bot')

    await waitFor(() => expect(screen.getByTestId('conversation-title')).toHaveTextContent('VP - H&G - CRM'))
    expect(screen.getByRole('button', { name: 'Open Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conversation options' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Sessions' }))
    expect(screen.getByTestId('messages-experience-icon-toggle')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close sessions' }))

    expect(isHiddenUntilMd(screen.getByTestId('conversation-command-session').className)).toBe(true)
    expect(isHiddenUntilMd(screen.getByTestId('conversation-mobile-subtitle').className)).toBe(true)
    expect(isHiddenUntilMd(screen.getByTestId('bot-computer-strip').className)).toBe(true)
    expect(isHiddenUntilMd(firstPaintContextHost().className)).toBe(true)
    expect(isHiddenUntilMd(screen.getByTestId('agent-workbench-rail').className)).toBe(true)
    expect(screen.getByTestId('agent-workbench-rail')).toHaveAttribute('data-open', 'false')
    expect(isHiddenUntilMd(screen.getByTestId('hermes-runtime-control-bar').className)).toBe(true)
    expect(isHiddenUntilMd(screen.getByTestId('conversation-design-commands').className)).toBe(true)

    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.getByLabelText('Attach file')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation options' }))
    const overflow = await screen.findByTestId('conversation-overflow-sheet')
    expect(overflow).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-command-session-badge')).toHaveTextContent('Command session')
    expect(within(overflow).getByTestId('bot-computer-strip')).toHaveTextContent('VPS · hermes-vps-01')
    expect(within(overflow).getByTestId('overflow-workbench')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-inspect')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-workbench-files')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-workbench-terminal')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-workbench-browser')).toBeInTheDocument()
    expect(within(overflow).getByLabelText('Approval mode')).toBeInTheDocument()
    expect(within(overflow).getByLabelText('Runtime thinking effort')).toBeInTheDocument()
    expect(within(overflow).getByTestId('conversation-overflow-runtime')).toHaveTextContent('0 queued')
    expect(within(overflow).getByTestId('overflow-experience-switch')).toBeInTheDocument()
    expect(within(overflow).getByRole('tab', { name: 'Bot mode' })).toBeInTheDocument()
    expect(within(overflow).getByRole('tab', { name: 'Messages' })).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-rename')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-export')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-archive')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-delete')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-manage-access')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-open-new-window')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-design-commands')).toBeInTheDocument()
    expect(within(overflow).getByTestId('overflow-design-command-polish')).toBeInTheDocument()
  })

  it('keeps computers, workbench, and inspect on desktop Bot mode', async () => {
    installViewport(1280)
    installFetch()
    renderMessages('bot')

    await waitFor(() => expect(screen.getByTestId('conversation-title')).toHaveTextContent('VP - H&G - CRM'))
    await waitFor(() => expect(screen.getByTestId('command-session-badge')).toBeInTheDocument())
    expect(screen.getByTestId('messages-experience-icon-toggle')).toHaveAttribute('data-experience-mode', 'bot')
    expect(screen.getByRole('button', { name: 'Switch to Messages' })).toBeInTheDocument()
    expect(screen.getByTestId('bot-computer-strip')).toHaveTextContent('Computers')
    expect(screen.getByTestId('hermes-runtime-control-bar')).toHaveTextContent('0 queued')
    expect(screen.getByTestId('hermes-agent-workbench-toggle')).toBeInTheDocument()
    expect(screen.getByLabelText('Approval mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Runtime thinking effort')).toBeInTheDocument()
    expect(screen.queryByTestId('conversation-overflow-sheet')).not.toBeInTheDocument()
  })
})
