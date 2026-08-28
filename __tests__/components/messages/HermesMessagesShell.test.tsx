import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HermesMessagesShell from '@/components/messages/hermes-desktop/HermesMessagesShell'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'
import { WORKSPACE_PANEL_EVENT } from '@/lib/hermes/workspace-panels'
import type { Conversation } from '@/components/chat/ConversationListItem'

const mockUnifiedChat = jest.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-unified-chat"
    data-org-id={String(props.orgId)}
    data-allow-agent-participants={String(props.allowAgentParticipants)}
    data-allow-delete={String(props.allowDeleteConversations)}
    data-allow-stop={String(props.allowStopRuns)}
    data-layout-variant={String(props.layoutVariant)}
    data-conversation-rail-mode={String(props.conversationRailMode)}
  />
))

const mockAgentRunSession = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-agent-run-session" data-agent-id={String(props.agentId)} data-run-id={String(props.runId)} />
))

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => mockUnifiedChat(props),
}))

jest.mock('@/components/agents/AgentRunSession', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => mockAgentRunSession(props),
}))

describe('HermesMessagesShell', () => {
  beforeEach(() => {
    mockUnifiedChat.mockClear()
    mockAgentRunSession.mockClear()
    window.localStorage.clear()
  })

  it('renders the dense Hermes-style workspace shell and passes chat capabilities through', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        orgName="Peet Co"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        userRole="admin"
        initialConvId="conv-1"
        capabilities={{
          allowStartConversations: true,
          allowSendMessages: true,
          allowAgentParticipants: true,
          allowArchiveConversations: false,
        }}
      />,
    )

    expect(screen.getByTestId('hermes-messages-shell')).toBeInTheDocument()
    expect(screen.getByTestId('hermes-messages-shell')).toHaveClass('min-h-0', 'lg:min-h-[640px]', 'rounded-none', 'border-0', 'shadow-none')
    expect(screen.getByTestId('hermes-messages-shell')).not.toHaveClass('min-h-[640px]')
    expect(screen.getByTestId('hermes-messages-shell')).toHaveAttribute('data-messages-experience', 'quiet-2026')
    expect(screen.getByTestId('hermes-messages-shell')).toHaveAttribute('data-tier', '0')
    expect(screen.queryByTestId('messages-neural-field')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pib-neural-field')).not.toBeInTheDocument()
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Messages')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).not.toHaveTextContent('Client portal / Messages')
    const messagesIcon = screen.getByTestId('hermes-messages-shell-topbar').querySelector('.material-symbols-outlined')
    expect(messagesIcon?.textContent).toContain('forum')
    expect(messagesIcon?.querySelector('.messages-hud-pulse')).toBeNull()
    expect(screen.getByTestId('hermes-messages-shell-topbar')).not.toHaveTextContent('Live')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).not.toHaveTextContent('Signal field')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).not.toHaveTextContent('Safe /v1 runs')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Agents enabled')
    expect(screen.getByRole('button', { name: 'Collapse sessions' })).toHaveClass('hidden', 'h-7', 'w-7', 'xl:grid')
    expect(screen.getByRole('button', { name: 'Stack panes vertically' })).toHaveClass('h-11', 'w-11', 'xl:h-7', 'xl:w-7')
    expect(screen.getByRole('button', { name: 'Open active session in split pane' })).toHaveClass('h-11', 'w-11', 'xl:h-7', 'xl:w-7')
    expect(screen.getByRole('tab', { name: 'Session' }).parentElement).toHaveClass('min-h-11', 'xl:h-6', 'xl:min-h-0')
    expect(screen.getByRole('button', { name: 'Close Session' })).toHaveClass('ml-1', 'h-11', 'w-11', 'xl:h-5', 'xl:w-5', 'xl:opacity-0')
    expect(screen.getByRole('button', { name: 'Park Session' })).toHaveClass('ml-1', 'h-11', 'w-11', 'xl:h-5', 'xl:w-5', 'xl:opacity-0')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-org-id', 'org-1')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-layout-variant', 'hermes')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-allow-stop', 'true')
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      orgName: 'Peet Co',
      currentUserUid: 'user-1',
      currentUserDisplayName: 'Peet',
      initialConvId: 'conv-1',
      allowDeleteConversations: false,
      allowStopRuns: true,
      allowAgentParticipants: true,
      allowStartConversations: true,
      allowSendMessages: true,
      allowArchiveConversations: false,
      layoutVariant: 'hermes',
      showAgentWorkbench: true,
      experienceMode: 'messages',
      onExperienceModeChange: expect.any(Function),
    }))
  })

  it('switches the workspace between Messages and Bot mode', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{
          allowStartConversations: true,
          allowSendMessages: true,
          allowAgentParticipants: true,
          allowArchiveConversations: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Bot mode' }))

    expect(screen.getByTestId('hermes-messages-shell')).toHaveAttribute('data-experience-mode', 'bot')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Bot mode')
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      experienceMode: 'bot',
      showAgentWorkbench: true,
    }))
    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }))
    expect(screen.getByTestId('hermes-messages-shell')).toHaveAttribute('data-experience-mode', 'messages')
  })

  it('enables delete controls for admin surface only', () => {
    render(
      <HermesMessagesShell
        surface="admin"
        orgId="org-1"
        currentUserUid="admin-1"
        currentUserDisplayName="Admin"
        capabilities={{
          allowStartConversations: true,
          allowSendMessages: true,
          allowAgentParticipants: false,
          allowArchiveConversations: true,
        }}
      />,
    )

    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Human-only')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-allow-delete', 'true')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-allow-stop', 'true')
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      allowDeleteConversations: true,
      allowStopRuns: true,
      allowAgentParticipants: false,
    }))
  })

  it('opens a second session pane with its own tab surface', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open active session in split pane' }))

    expect(screen.getByTestId('messages-workspace-pane-primary')).toBeInTheDocument()
    expect(screen.getByTestId('messages-workspace-pane-secondary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close split pane' })).toHaveClass('h-11', 'w-11', 'xl:h-6', 'xl:w-6')
    expect(screen.getByRole('button', { name: 'Resize workspace panes' })).toHaveClass('hidden', 'xl:block', 'xl:min-w-0', 'xl:w-2')
    expect(mockUnifiedChat).toHaveBeenLastCalledWith(expect.objectContaining({
      activeConversationId: 'conv-1',
      showConversationList: false,
    }))
  })

  it('uses one full-width focused surface below desktop and keeps narrow split switching available', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open active session in split pane' }))

    const primary = screen.getByTestId('messages-workspace-pane-primary')
    const secondary = screen.getByTestId('messages-workspace-pane-secondary')
    const resizer = screen.getByRole('button', { name: 'Resize workspace panes' })

    expect(primary).toHaveClass('flex-1', 'basis-full', 'xl:flex-none', 'xl:basis-[var(--workspace-pane-basis)]', 'max-xl:hidden')
    expect(secondary).toHaveClass('flex-1', 'basis-full', 'xl:flex-none', 'xl:basis-[var(--workspace-pane-basis)]')
    expect(secondary).not.toHaveClass('max-xl:hidden')
    // The visible desktop resizer is 8px with -2px margins on each side, so it
    // contributes a net 4px to the flex line. Each split pane gives back 2px;
    // together the two bases plus the resizer therefore fit exactly.
    expect(primary.style.getPropertyValue('--workspace-pane-basis')).toBe('calc(50% - 2px)')
    expect(secondary.style.getPropertyValue('--workspace-pane-basis')).toBe('calc(50% - 2px)')
    expect(primary.style.flex).toBe('')
    expect(secondary.style.flex).toBe('')
    expect(resizer).toHaveClass('hidden', 'xl:block')

    fireEvent.click(screen.getByRole('button', { name: 'Show primary pane' }))

    expect(primary).not.toHaveClass('max-xl:hidden')
    expect(secondary).toHaveClass('max-xl:hidden')
    expect(screen.getByRole('button', { name: 'Show secondary pane' })).toBeInTheDocument()
  })

  it('persists a focus-mode Sessions rail without hiding the conversation catalogue', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sessions' }))
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-conversation-rail-mode', 'collapsed')
    expect(JSON.parse(window.localStorage.getItem('pib.messages.workspace.v1:org-1:user-1') ?? '{}')).toMatchObject({ conversationRailMode: 'collapsed' })

    fireEvent.click(screen.getByRole('button', { name: 'Expand sessions' }))
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-conversation-rail-mode', 'expanded')
  })

  it('temporarily frees Sessions space for Dual Focus without overwriting the saved rail preference', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    const primaryProps = mockUnifiedChat.mock.calls.at(-1)?.[0] as { onContextCanvasPresentationChange?: (state: { open: boolean; mode: 'single' | 'dual' }) => void }
    act(() => primaryProps.onContextCanvasPresentationChange?.({ open: true, mode: 'dual' }))
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-conversation-rail-mode', 'collapsed')
    expect(JSON.parse(window.localStorage.getItem('pib.messages.workspace.v1:org-1:user-1') ?? '{}')).toMatchObject({ conversationRailMode: 'expanded' })

    act(() => primaryProps.onContextCanvasPresentationChange?.({ open: false, mode: 'dual' }))
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-conversation-rail-mode', 'expanded')
  })

  it('places safe agent-generated workspace UI in its own pane', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    fireEvent(window, new CustomEvent(WORKSPACE_PANEL_EVENT, { detail: {
      type: 'workspace_panel', id: 'growth', title: 'Growth cockpit', metrics: [{ label: 'Leads', value: '42' }], sections: [], columns: [], rows: [],
    } }))

    expect(screen.getByTestId('messages-workspace-pane-secondary')).toBeInTheDocument()
    expect(screen.getByTestId('generated-workspace-panel-growth')).toHaveTextContent('Growth cockpit')
    expect(screen.getByTestId('generated-workspace-panel-growth')).toHaveTextContent('42')
  })
  it('renames a conversation tab on double-click and persists the title', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true })) as jest.Mock
    global.fetch = fetchMock

    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    const catalogue = mockUnifiedChat.mock.calls[0]?.[0]?.onConversationsChange as ((conversations: Conversation[]) => void) | undefined
    act(() => {
      catalogue?.([{ id: 'conv-1', title: 'New conversation' } as Conversation])
    })

    const tab = await screen.findByRole('tab', { name: 'New conversation' })
    fireEvent.doubleClick(tab)

    const input = screen.getByTestId('workspace-tab-rename-conv-1')
    fireEvent.change(input, { target: { value: 'Security incident' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('tab', { name: 'Security incident' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/conversations/conv-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ title: 'Security incident' }),
    }))
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      syncedConversationTitles: expect.objectContaining({ 'conv-1': 'Security incident' }),
    }))
  })

  it('matches workspace tab accents to Cowork folder seeds from the conversation catalogue', () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    const catalogue = mockUnifiedChat.mock.calls[0]?.[0]?.onConversationsChange as ((conversations: Conversation[]) => void) | undefined
    act(() => {
      catalogue?.([{
        id: 'conv-1',
        title: 'Dawid Account',
        workspaceContext: { companyId: 'company-sa-gun', companyName: 'SA Gun Auctions' },
      } as Conversation])
    })

    const tab = screen.getByTestId('workspace-tab-conv-1')
    expect(tab).toHaveAttribute('data-folder-accent', 'company:company-sa-gun')
    expect(tab).toHaveClass('mx-folder-accent')
    expect(tab.style.getPropertyValue('--mx-folder-accent')).toMatch(/^#/)
  })

  it('parks a workspace tab in the right rail and resumes it in the focused pane', async () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
      />,
    )

    const catalogue = mockUnifiedChat.mock.calls[0]?.[0]?.onConversationsChange as ((conversations: Conversation[]) => void) | undefined
    act(() => {
      catalogue?.([
        { id: 'conv-1', title: 'Graphs' } as Conversation,
        { id: 'conv-2', title: 'Sanparks' } as Conversation,
      ])
    })
    const open = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onActiveConversationChange as ((conversationId: string | null) => void) | undefined
    act(() => open?.('conv-2'))

    const graphsTab = screen.getByTestId('workspace-tab-conv-1')
    fireEvent.click(graphsTab.querySelector('[aria-label="Park Graphs"]')!)

    await waitFor(() => expect(screen.queryByTestId('workspace-tab-conv-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('messages-parked-tabs-inline')).toBeInTheDocument()
    expect(screen.getByTestId('parked-workspace-tab-conv-1')).toHaveTextContent('Graphs')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Parked 1')
    expect(mockUnifiedChat).toHaveBeenLastCalledWith(expect.objectContaining({ activeConversationId: 'conv-2' }))

    // Selecting the same session from the normal Sessions rail also resumes it
    // instead of leaving a duplicate tab in the parked rail.
    const resumeFromSessionsRail = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onActiveConversationChange as ((conversationId: string | null) => void) | undefined
    act(() => resumeFromSessionsRail?.('conv-1'))
    expect(screen.queryByTestId('messages-parked-tabs-inline')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-conv-1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('workspace-tab-conv-1').querySelector('[aria-label="Park Graphs"]')!)
    await screen.findByRole('button', { name: 'Resume Graphs' })
    fireEvent.click(screen.getByRole('button', { name: 'Resume Graphs' }))

    await waitFor(() => expect(screen.queryByTestId('messages-parked-tabs-inline')).not.toBeInTheDocument())
    expect(screen.getByTestId('workspace-tab-conv-1')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Graphs' })).toHaveAttribute('aria-selected', 'true')
    expect(mockUnifiedChat).toHaveBeenLastCalledWith(expect.objectContaining({ activeConversationId: 'conv-1' }))
  })

  it('pulses a background tab while running and underlines it until opened', async () => {
    render(
      <HermesMessagesShell
        surface="portal"
        orgId="org-1"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        initialConvId="conv-1"
        capabilities={{
          allowStartConversations: true,
          allowSendMessages: true,
          allowAgentParticipants: true,
          allowArchiveConversations: true,
        }}
      />,
    )

    const open = mockUnifiedChat.mock.calls[0]?.[0]?.onActiveConversationChange as
      | ((conversationId: string | null) => void)
      | undefined
    const lifecycle = mockUnifiedChat.mock.calls[0]?.[0]?.onConversationLifecycle as
      | ((event: { conversationId: string; phase: 'running' | 'completed' | 'idle' }) => void)
      | undefined

    act(() => {
      open?.('conv-1')
      open?.('conv-2')
    })

    act(() => {
      lifecycle?.({ conversationId: 'conv-1', phase: 'running' })
    })

    const backgroundWhileRunning = screen.getByTestId('workspace-tab-conv-1')
    expect(backgroundWhileRunning).toHaveAttribute('data-tab-activity', 'running')
    expect(backgroundWhileRunning).toHaveClass('mx-tab-running')

    act(() => {
      lifecycle?.({ conversationId: 'conv-1', phase: 'completed' })
    })

    const backgroundWhileUnread = screen.getByTestId('workspace-tab-conv-1')
    expect(backgroundWhileUnread).toHaveAttribute('data-tab-activity', 'unread')
    expect(backgroundWhileUnread).toHaveClass('mx-tab-unread')
    expect(backgroundWhileUnread).not.toHaveClass('mx-tab-running')

    act(() => {
      fireEvent.click(screen.getByTestId('workspace-tab-conv-1').querySelector('[role="tab"]')!)
    })

    // After opening, activity chrome is cleared (active tab never shows it).
    expect(screen.getByTestId('workspace-tab-conv-1')).not.toHaveAttribute('data-tab-activity')
  })

  it('checks a running background tab only when the realtime gateway invalidates it', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: { messages: [{ role: 'assistant', runId: 'run-1', status: 'completed' }] } }),
    } as Response)
    try {
      render(
        <HermesMessagesShell
          surface="portal"
          orgId="org-1"
          currentUserUid="user-1"
          currentUserDisplayName="Peet"
          initialConvId="conv-1"
          capabilities={{ allowStartConversations: true, allowSendMessages: true, allowAgentParticipants: true, allowArchiveConversations: true }}
        />,
      )
      const open = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onActiveConversationChange as
        | ((conversationId: string | null) => void)
        | undefined
      const lifecycle = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onConversationLifecycle as
        | ((event: { conversationId: string; phase: 'running' | 'completed' | 'idle' }) => void)
        | undefined
      act(() => {
        open?.('conv-2')
        lifecycle?.({ conversationId: 'conv-1', phase: 'running' })
      })
      await screen.findByTestId('workspace-tab-conv-1')

      const connectionChange = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onRealtimeGatewayConnectionChange as
        | ((clientId: string, ready: boolean) => void)
        | undefined
      const invalidate = mockUnifiedChat.mock.calls.at(-1)?.[0]?.onConversationRealtimeInvalidation as
        | ((event: { conversationId: string; eventId: string }) => void)
        | undefined
      act(() => connectionChange?.('gateway-client-1', true))
      act(() => invalidate?.({ conversationId: 'conv-1', eventId: 'evt:v1:conv-1:2' }))

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/conversations/conv-1/messages?limit=20',
        { cache: 'no-store' },
      ))
      await waitFor(() => expect(screen.getByTestId('workspace-tab-conv-1')).toHaveAttribute('data-tab-activity', 'unread'))
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('MessagesWorkspace', () => {
  beforeEach(() => {
    mockUnifiedChat.mockClear()
    mockAgentRunSession.mockClear()
    window.localStorage.clear()
  })

  it('routes normal portal messages through the Hermes shell', () => {
    render(
      <MessagesWorkspace
        surface="portal"
        orgId="org-1"
        orgName="Peet Co"
        currentUserUid="user-1"
        currentUserDisplayName="Peet"
        userRole="admin"
      />,
    )

    expect(screen.getByTestId('hermes-messages-shell')).toBeInTheDocument()
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-allow-agent-participants', 'true')
  })

  it('keeps admin run deep links on AgentRunSession', () => {
    render(
      <MessagesWorkspace
        surface="admin"
        orgId="org-1"
        orgSlug="peet-co"
        currentUserUid="admin-1"
        currentUserDisplayName="Admin"
        initialAgentId="pip"
        initialRunId="run-1"
        initialTaskId="task-1"
        initialTaskTitle="Investigate"
      />,
    )

    expect(screen.getByTestId('mock-agent-run-session')).toHaveAttribute('data-agent-id', 'pip')
    expect(screen.queryByTestId('hermes-messages-shell')).not.toBeInTheDocument()
    expect(mockUnifiedChat).not.toHaveBeenCalled()
  })
})
