import {
  buildGmailSearchQuery,
  extractMailboxDateWindow,
  mailboxMessageMatchesQuery,
  parseFromHeader,
  tokenizeMailboxQuery,
} from '@/lib/mailbox/messageSearch'

describe('messageSearch', () => {
  it('parses display name and email from From headers', () => {
    expect(parseFromHeader('Rikus Stander <rs@ahslaw.co.za>')).toEqual({
      email: 'rs@ahslaw.co.za',
      name: 'Rikus Stander',
      raw: 'Rikus Stander <rs@ahslaw.co.za>',
    })
    expect(parseFromHeader('rs@ahslaw.co.za')).toEqual({
      email: 'rs@ahslaw.co.za',
      name: '',
      raw: 'rs@ahslaw.co.za',
    })
  })

  it('tokenizes OR / name / email queries without requiring the whole phrase', () => {
    expect(tokenizeMailboxQuery('Rikus Stander OR rs@ahslaw.co.za')).toEqual(
      expect.arrayContaining(['rikus', 'stander', 'rs@ahslaw.co.za']),
    )
  })

  it('extracts a calendar day window from natural dates', () => {
    const window = extractMailboxDateWindow('emails on July 20th', new Date('2026-07-23T12:00:00Z'))
    expect(window?.start.toISOString()).toBe('2026-07-20T00:00:00.000Z')
    expect(window?.end.toISOString()).toBe('2026-07-21T00:00:00.000Z')
  })

  it('matches by fromName or email and optional date window', () => {
    const message = {
      subject: 'Laaste 1 vir die dag',
      from: 'rs@ahslaw.co.za',
      fromName: 'Rikus Stander',
      accountEmail: 'peet.stander@partnersinbiz.online',
      snippet: 'Unfair Dismissal',
      to: ['peet.stander@partnersinbiz.online'],
      cc: [] as string[],
      receivedAt: '2026-07-20T08:19:25.000Z',
      sentAt: null,
      createdAt: '2026-07-20T08:19:25.000Z',
    }
    expect(mailboxMessageMatchesQuery(message, 'Rikus Stander OR rs@ahslaw.co.za specifically on July 20th', new Date('2026-07-23T12:00:00Z'))).toBe(true)
    expect(mailboxMessageMatchesQuery(message, 'Rikus Stander', new Date('2026-07-23T12:00:00Z'))).toBe(true)
    expect(mailboxMessageMatchesQuery(message, 'rs@ahslaw.co.za July 21', new Date('2026-07-23T12:00:00Z'))).toBe(false)
  })

  it('builds a live Gmail q with from:/after:/before: when useful', () => {
    expect(buildGmailSearchQuery('rs@ahslaw.co.za July 20', new Date('2026-07-23T12:00:00Z'))).toContain('from:rs@ahslaw.co.za')
    expect(buildGmailSearchQuery('Rikus Stander July 20', new Date('2026-07-23T12:00:00Z'))).toMatch(/after:2026\/07\/20/)
    expect(buildGmailSearchQuery('from:rs@ahslaw.co.za after:2026/07/20')).toBe('from:rs@ahslaw.co.za after:2026/07/20')
  })
})
