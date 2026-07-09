import { render, screen } from '@testing-library/react'
import HermesMessagesShell from '@/components/messages/hermes-desktop/HermesMessagesShell'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'

const mockUnifiedChat = jest.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-unified-chat"
    data-org-id={String(props.orgId)}
    data-allow-agent-participants={String(props.allowAgentParticipants)}
    data-allow-delete={String(props.allowDeleteConversations)}
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
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Client portal / Messages')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Agents enabled')
    expect(screen.getByTestId('hermes-messages-shell-topbar')).toHaveTextContent('Safe /v1 runs')
    expect(screen.getByTestId('mock-unified-chat')).toHaveAttribute('data-org-id', 'org-1')
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
})

describe('MessagesWorkspace', () => {
  beforeEach(() => {
    mockUnifiedChat.mockClear()
    mockAgentRunSession.mockClear()
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
