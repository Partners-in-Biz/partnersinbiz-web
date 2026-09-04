import { render, screen } from '@testing-library/react'
import ConversationListItem, { type Conversation } from '@/components/chat/ConversationListItem'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    participants: [{ kind: 'agent', agentId: 'pip', name: 'Pip' }],
    participantUids: ['user-1'],
    participantAgentIds: ['pip'],
    startedBy: 'user-1',
    title: 'Incident report follow-up',
    lastMessagePreview: 'Done — the incident report is filed.',
    messageCount: 4,
    archived: false,
    workspaceContext: {
      workspaceId: 'ws-1',
      orgName: 'Partners in Biz',
      runtimeTarget: 'local',
      runtimeLabel: 'PEETS-MAC-MINI-LOCAL',
      shareMode: 'private',
    },
    lastMessageAt: { seconds: Math.floor(Date.now() / 1000) - 120 },
    ...overrides,
  }
}

describe('ConversationListItem', () => {
  it('shows the chat title prominently in compact cards and keeps long runtime labels inside the card', () => {
    const { container } = render(
      <ConversationListItem
        conversation={makeConversation()}
        active={false}
        onClick={() => {}}
        currentUserUid="user-1"
        density="compact"
      />,
    )

    const row = screen.getByTestId('conversation-row-conv-1')
    expect(row).toHaveClass('overflow-hidden')
    expect(row).toHaveTextContent('Incident report follow-up')
    expect(row).toHaveTextContent('PEETS-MAC-MINI-LOCAL')
    expect(row.querySelector('.truncate')).not.toBeNull()
    expect(container.querySelector('.overflow-hidden')).not.toBeNull()
    // Compact rows use HoverTip instead of a slow native title attribute.
    expect(row).not.toHaveAttribute('title')
  })

  it('shows the project name on compact project sessions', () => {
    render(
      <ConversationListItem
        conversation={makeConversation({
          scope: 'project',
          scopeRefId: 'project-1',
          workspaceContext: {
            workspaceId: 'ws-1',
            orgName: 'Partners in Biz',
            runtimeTarget: 'linked-device:vps',
            runtimeLabel: 'Partners VPS',
            shareMode: 'private',
            projectId: 'project-1',
            projectName: 'AHS Law - SEO 90-day Sprint',
          },
        })}
        active={false}
        onClick={() => {}}
        currentUserUid="user-1"
        density="compact"
      />,
    )

    expect(screen.getByTestId('conversation-project-badge-conv-1')).toHaveTextContent('AHS Law - SEO 90-day Sprint')
  })

  it('shows the current member unread count in the session rail', () => {
    render(
      <ConversationListItem
        conversation={makeConversation({ unreadCount: 3 })}
        active={false}
        onClick={() => {}}
        currentUserUid="user-1"
        density="compact"
      />,
    )

    expect(screen.getByLabelText('3 unread messages')).toHaveTextContent('3')
  })

  it('renders a Needs you pill when the conversation needs attention', () => {
    render(
      <ConversationListItem
        conversation={makeConversation({ needsYou: true })}
        active={false}
        onClick={() => {}}
        currentUserUid="user-1"
        density="compact"
      />,
    )

    expect(screen.getByTestId('conversation-needs-you-conv-1')).toHaveTextContent('Needs you')
  })
})
