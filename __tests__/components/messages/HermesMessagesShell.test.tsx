import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(mockUnifiedChat).toHaveBeenLastCalledWith(expect.objectContaining({
      activeConversationId: 'conv-1',
      showConversationList: false,
    }))
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
