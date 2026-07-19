import { act, fireEvent, render, screen } from '@testing-library/react'
import HermesMessagesShell from '@/components/messages/hermes-desktop/HermesMessagesShell'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'
import { WORKSPACE_PANEL_EVENT } from '@/lib/hermes/workspace-panels'

const mockUnifiedChat = jest.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-unified-chat"
    data-org-id={String(props.orgId)}
    data-allow-agent-participants={String(props.allowAgentParticipants)}
    data-allow-delete={String(props.allowDeleteConversations)}
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
    expect(screen.getByTestId('hermes-messages-shell')).toHaveClass('min-h-0', 'lg:min-h-[640px]')
    expect(screen.getByTestId('hermes-messages-shell')).not.toHaveClass('min-h-[640px]')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Client portal / Messages')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Agents enabled')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Safe /v1 runs')
    expect(screen.getByRole('button', { name: 'Collapse sessions' })).toHaveClass('h-11', 'w-11', 'xl:h-7', 'xl:w-7')
    expect(screen.getByRole('button', { name: 'Stack panes vertically' })).toHaveClass('h-11', 'w-11', 'xl:h-7', 'xl:w-7')
    expect(screen.getByRole('button', { name: 'Open active session in split pane' })).toHaveClass('h-11', 'w-11', 'xl:h-7', 'xl:w-7')
    expect(screen.getByRole('tab', { name: 'Session' }).parentElement).toHaveClass('min-h-11', 'xl:h-6', 'xl:min-h-0')
    expect(screen.getByRole('button', { name: 'Close Session' })).toHaveClass('h-11', 'w-11', 'xl:h-4', 'xl:w-4', 'xl:opacity-0')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-org-id', 'org-1')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-layout-variant', 'hermes')
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      orgName: 'Peet Co',
      currentUserUid: 'user-1',
      currentUserDisplayName: 'Peet',
      initialConvId: 'conv-1',
      allowDeleteConversations: false,
      allowAgentParticipants: true,
      allowStartConversations: true,
      allowSendMessages: true,
      allowArchiveConversations: false,
      layoutVariant: 'hermes',
    }))
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
    expect(mockUnifiedChat).toHaveBeenCalledWith(expect.objectContaining({
      allowDeleteConversations: true,
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
