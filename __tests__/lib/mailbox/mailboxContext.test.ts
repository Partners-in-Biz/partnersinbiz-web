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
      conversationId: 'conv-1',
      responseMessageId: 'assistant-1',
    })
    expect(block).toContain('status: connected')
    expect(block).toContain('me@example.com')
    expect(block).toContain('/api/v1/agent/email/accounts')
    expect(block).toContain('/api/v1/agent/email/messages')
    expect(block).toContain('Hard scope: only uid=user-1')
    expect(block).toContain('live Gmail search')
    expect(block).toContain('GET /api/v1/agent/email/messages/{id}')
    expect(block).toContain('NEVER ask the user to paste')
    expect(block).toContain('delegationEvidenceId=mailbox-dlg-1')
    expect(block).toContain('Never auto-send')
    expect(block).toContain('EMAIL CANVAS')
    expect(block).toContain('conversationId=conv-1')
    expect(block).toContain('responseMessageId=assistant-1')
    expect(block).toContain('NEVER paste a full email as chat-only')
    expect(block).toContain('mailbox call failed')
    expect(block).not.toMatch(/re-send a message to mint a token/i)
    expect(block).not.toMatch(/send any chat message to (re)?mint/i)
  })

  it('tells staff agents to use the platform mailbox org when remapped from a client chat', () => {
    const block = buildMailboxContextPromptBlock({
      orgId: 'pib-platform-owner',
      uid: 'stean',
      accounts: [{ ...connected, orgId: 'pib-platform-owner', uid: 'stean' }],
      conversationOrgId: 'wS5pgwa6c9WbPocf4w0w',
      conversationId: 'conv-el',
      responseMessageId: 'asst-el',
    })
    expect(block).toContain('orgId: pib-platform-owner')
    expect(block).toContain('conversationOrgId: wS5pgwa6c9WbPocf4w0w')
    expect(block).toContain('Always pass orgId=pib-platform-owner')
    expect(block).toContain('do not use the conversation org for mailbox')
  })

  it('reports none when no connected accounts exist but still requires email canvas drafts', () => {
    const block = buildMailboxContextPromptBlock({
      orgId: 'org-1',
      uid: 'user-1',
      accounts: [{ ...connected, status: 'needs_setup' }],
      conversationId: 'conv-9',
      responseMessageId: 'asst-9',
    })
    expect(block).toContain('status: none')
    expect(block).toContain('No connected Gmail/SMTP mailbox')
    expect(block).toContain('POST /api/v1/agent/email/drafts')
    expect(block).toContain('EMAIL CANVAS')
    expect(block).toContain('conversationId=conv-9')
    expect(block).toContain('responseMessageId=asst-9')
    expect(block).toContain('NEVER paste a full email as chat-only')
  })
})
