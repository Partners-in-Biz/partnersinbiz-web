import { emailChatActions } from '@/lib/chat-context/adapters/email'
import type { MailboxMessageSafe } from '@/lib/mailbox/types'

function message(overrides: Partial<MailboxMessageSafe> = {}): MailboxMessageSafe {
  return {
    id: 'email-1',
    orgId: 'org-1',
    uid: 'admin-1',
    profileId: 'org-1_admin-1',
    accountId: 'account-1',
    accountEmail: 'hello@example.test',
    folder: 'inbox',
    direction: 'inbound',
    status: 'received',
    read: false,
    starred: false,
    from: 'client@example.test',
    to: ['hello@example.test'],
    cc: [],
    bcc: [],
    subject: 'Launch',
    bodyText: 'Please confirm.',
    attachments: [],
    snippet: 'Please confirm.',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z',
    ...overrides,
  }
}

describe('email chat actions', () => {
  it('offers confirmation-gated safe mailbox controls through the owner endpoint', () => {
    expect(emailChatActions(message(), 'client')).toEqual([
      expect.objectContaining({
        id: 'mark-read-email:email-1',
        href: '/api/v1/portal/email/messages/email-1?orgId=org-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { read: true },
      }),
      expect.objectContaining({ id: 'star-email:email-1', body: { starred: true } }),
      expect.objectContaining({ id: 'archive-email:email-1', body: { folder: 'archive' } }),
    ])
  })

  it('restores archived messages but does not expose inline delete or send actions', () => {
    const actions = emailChatActions(message({ folder: 'archive', read: true, starred: true }), 'admin')
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mark-unread-email:email-1' }),
      expect.objectContaining({ id: 'unstar-email:email-1' }),
      expect.objectContaining({ id: 'restore-email:email-1', body: { folder: 'inbox' } }),
    ]))
    expect(actions.some((action) => action.method === 'DELETE' || /send|reply|trash|delete/i.test(action.id))).toBe(false)
  })

  it('does not offer owner endpoints to a pure agent caller', () => {
    expect(emailChatActions(message(), 'ai')).toEqual([])
  })
})
