import { buildDelegationAuthPromptBlock, CHAT_REMINT_RITUAL_PATTERNS } from '@/lib/api/delegations'
import { buildMailboxContextPromptBlock } from '@/lib/mailbox/mailboxContext'
import { classifyMessagesPromptIntent } from '@/lib/messages/prompt-profile'

function assertNoChatRemintRitual(value: string) {
  for (const pattern of CHAT_REMINT_RITUAL_PATTERNS) {
    expect(value).not.toMatch(pattern)
  }
}

describe('user-visible mailbox / delegation copy', () => {
  it('does not instruct staff to remint via chat', () => {
    const delegation = buildDelegationAuthPromptBlock({
      token: 'pib_dlg_abc',
      expiresAt: '2099-01-01T00:00:00.000Z',
      orgId: 'org-1',
      agentId: 'pip',
      actingForUserId: 'staff-1',
      scopes: [],
      mailboxDelegationEvidenceId: 'ev-1',
    })
    const mailbox = buildMailboxContextPromptBlock({
      orgId: 'org-1',
      uid: 'staff-1',
      accounts: [],
    })

    assertNoChatRemintRitual(delegation)
    assertNoChatRemintRitual(mailbox)
    expect(delegation).toContain('mailbox call failed')
    expect(mailbox).toContain('mailbox call failed')
  })

  it('marks every Messages turn as needing a fresh delegation', () => {
    expect(classifyMessagesPromptIntent({ content: 'Hello' }).needsDelegation).toBe(true)
    expect(classifyMessagesPromptIntent({ content: 'What is in my inbox?' }).needsDelegation).toBe(true)
    expect(classifyMessagesPromptIntent({ content: 'Create the CRM spec document' }).needsDelegation).toBe(true)
  })
})
