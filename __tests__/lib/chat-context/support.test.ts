import { supportChatActions } from '@/lib/chat-context/adapters/support'
import type { SupportTicket } from '@/lib/support/types'

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'support-1',
    orgId: 'org-1',
    createdBy: 'client-1',
    requesterName: 'Jane Client',
    requesterEmail: 'jane@example.com',
    category: 'bug',
    subject: 'Launch issue',
    description: 'The launch page is not loading.',
    status: 'waiting_on_us',
    priority: 'normal',
    messageCount: 2,
    ...overrides,
  }
}

describe('support chat actions', () => {
  it('keeps client members and agent identities read-only', () => {
    expect(supportChatActions({
      ticket: ticket(),
      user: { uid: 'client-1', role: 'client', orgId: 'org-1' },
    })).toEqual([])
    expect(supportChatActions({
      ticket: ticket(),
      user: { uid: 'agent:support', role: 'ai', agentId: 'support', orgId: 'org-1' },
    })).toEqual([])
  })

  it('lets a human admin claim, raise one priority level, and resolve an open ticket', () => {
    expect(supportChatActions({
      ticket: ticket(),
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).toEqual([
      {
        id: 'claim-support-ticket:support-1',
        label: 'Assign to me',
        href: '/api/v1/admin/support/support-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { assigneeUserId: 'admin-1' },
      },
      {
        id: 'raise-support-priority:support-1:high',
        label: 'Raise priority to High',
        href: '/api/v1/admin/support/support-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { priority: 'high' },
      },
      {
        id: 'resolve-support-ticket:support-1',
        label: 'Resolve ticket',
        href: '/api/v1/admin/support/support-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { status: 'resolved' },
      },
    ])
  })

  it('never escalates beyond urgent and reopens resolved work into the actionable queue', () => {
    expect(supportChatActions({
      ticket: ticket({
        status: 'resolved',
        priority: 'urgent',
        assigneeUserId: 'admin-1',
      }),
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).toEqual([{
      id: 'reopen-support-ticket:support-1',
      label: 'Reopen ticket',
      href: '/api/v1/admin/support/support-1',
      method: 'PATCH',
      requiresApproval: true,
      body: { status: 'waiting_on_us' },
    }])
  })
})
