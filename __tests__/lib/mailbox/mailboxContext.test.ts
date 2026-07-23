import { buildMailboxContextPromptBlock } from '@/lib/mailbox/mailboxContext'
import type { MailboxAccountSafe } from '@/lib/mailbox/types'

const connected: MailboxAccountSafe = {
  id: 'acct-1',
  orgId: 'org-1',
  uid: 'user-1',
  profileId: 'org-1_user-1',
  provider: 'google',
  emailAddress: 'me@example.com',
  displayName: 'Me',
  status: 'connected',
  isDefault: true,
  hasSmtp: false,
  hasImap: false,
  hasGoogleOAuth: true,
  lastSyncAt: '2026-07-23T10:00:00.000Z',
  createdAt: null,
  updatedAt: null,
}

describe('buildMailboxContextPromptBlock', () => {
  it('tells agents to use agent email APIs when a mailbox is connected', () => {
    const block = buildMailboxContextPromptBlock({
      orgId: 'org-1',
      uid: 'user-1',
      accounts: [connected],
      mailboxDelegationEvidenceId: 'mailbox-dlg-1',
    })
    expect(block).toContain('status: connected')
    expect(block).toContain('me@example.com')
    expect(block).toContain('/api/v1/agent/email/accounts')
    expect(block).toContain('/api/v1/agent/email/messages')
    expect(block).toContain('delegationEvidenceId=mailbox-dlg-1')
    expect(block).toContain('Never auto-send')
  })

  it('reports none when no connected accounts exist', () => {
    const block = buildMailboxContextPromptBlock({
      orgId: 'org-1',
      uid: 'user-1',
      accounts: [{ ...connected, status: 'needs_setup' }],
    })
    expect(block).toContain('status: none')
    expect(block).toContain('No connected Gmail/SMTP mailbox')
  })
})
