// __tests__/lib/mailbox/applyInboundContactFacts.test.ts

jest.mock('@/lib/mailbox/linkMailboxSendToContacts', () => ({
  findOrgContactsByEmails: jest.fn(),
}))

const mockContactGet = jest.fn()
const mockApplyMailbox = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'contacts') {
        return {
          doc: jest.fn(() => ({ get: mockContactGet })),
        }
      }
      return { doc: jest.fn(), where: jest.fn().mockReturnThis() }
    }),
  },
}))

jest.mock('@/lib/crm/facts/apply-mailbox', () => ({
  applyMailboxFactsToContact: (...args: unknown[]) => mockApplyMailbox(...args),
}))

import { findOrgContactsByEmails } from '@/lib/mailbox/linkMailboxSendToContacts'
import { applyInboundMailboxFactsForMatchedContacts } from '@/lib/mailbox/applyInboundContactFacts'

const mockFind = findOrgContactsByEmails as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFind.mockResolvedValue([])
  mockApplyMailbox.mockResolvedValue({
    dryRun: false,
    candidateCount: 1,
    storedCount: 1,
    candidates: [],
    results: [{ field: 'title', value: 'CEO', result: { stored: true, applied: false } }],
  })
  mockContactGet.mockResolvedValue({
    exists: true,
    id: 'c1',
    data: () => ({ orgId: 'org-1', name: 'Jane', email: 'jane@acme.com', deleted: false }),
  })
})

describe('applyInboundMailboxFactsForMatchedContacts', () => {
  it('returns empty when body or from email missing', async () => {
    const result = await applyInboundMailboxFactsForMatchedContacts({
      orgId: 'org-1',
      fromEmail: 'jane@acme.com',
      bodyText: '',
    })
    expect(result.storedCount).toBe(0)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('applies mailbox facts for matched contacts', async () => {
    mockFind.mockResolvedValue([{ contactId: 'c1', email: 'jane@acme.com', name: 'Jane' }])
    const result = await applyInboundMailboxFactsForMatchedContacts({
      orgId: 'org-1',
      fromEmail: 'jane@acme.com',
      fromName: 'Jane Doe',
      bodyText: 'Jane Doe\nCEO\nAcme',
      agentId: 'agent-mailbox-gmail',
      sourceUrl: 'mailbox:gmail:message:m1',
    })
    expect(mockFind).toHaveBeenCalledWith('org-1', ['jane@acme.com'])
    expect(mockApplyMailbox).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        bodyText: 'Jane Doe\nCEO\nAcme',
        fromEmail: 'jane@acme.com',
        direction: 'inbound',
        agentId: 'agent-mailbox-gmail',
      }),
    )
    expect(result.contactIds).toEqual(['c1'])
    expect(result.storedCount).toBe(1)
    expect(result.candidateCount).toBe(1)
  })

  it('swallows matcher failures', async () => {
    mockFind.mockRejectedValue(new Error('firestore down'))
    const result = await applyInboundMailboxFactsForMatchedContacts({
      orgId: 'org-1',
      fromEmail: 'jane@acme.com',
      bodyText: 'hi',
    })
    expect(result).toEqual({
      contactIds: [],
      candidateCount: 0,
      storedCount: 0,
      appliedCount: 0,
    })
  })
})
