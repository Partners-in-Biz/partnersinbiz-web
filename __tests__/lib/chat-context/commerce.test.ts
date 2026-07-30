import { commerceChatActions } from '@/lib/chat-context/adapters/commerce'

describe('commerce chat actions', () => {
  it('keeps viewers read-only', () => {
    expect(commerceChatActions({
      kind: 'invoice',
      id: 'invoice-1',
      data: { status: 'draft', clientDetails: { email: 'client@example.com' } },
      perspectiveOrgId: 'org-1',
      actorRole: 'viewer',
      canManageSourceOrg: true,
    })).toEqual([])
  })

  it('sends a draft invoice only when the actor can manage the source org and a recipient exists', () => {
    expect(commerceChatActions({
      kind: 'invoice',
      id: 'invoice-1',
      data: { status: 'draft', clientDetails: { email: 'client@example.com' } },
      perspectiveOrgId: 'org-1',
      actorRole: 'admin',
      canManageSourceOrg: true,
    })).toEqual([{
      id: 'send-invoice:invoice-1',
      label: 'Send invoice to client@example.com',
      href: '/api/v1/invoices/invoice-1/send',
      method: 'POST',
      requiresApproval: true,
    }])

    expect(commerceChatActions({
      kind: 'invoice',
      id: 'invoice-1',
      data: { status: 'draft' },
      perspectiveOrgId: 'org-1',
      actorRole: 'admin',
      canManageSourceOrg: true,
    })).toEqual([])
  })

  it('sends draft quotes only from the sender perspective', () => {
    expect(commerceChatActions({
      kind: 'quote',
      id: 'quote-1',
      data: {
        orgId: 'sender-org',
        sourceOrgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        status: 'draft',
        recipientEmail: 'buyer@example.com',
      },
      perspectiveOrgId: 'sender-org',
      actorRole: 'member',
    })).toEqual([expect.objectContaining({
      id: 'send-quote:quote-1',
      href: '/api/v1/quotes/quote-1/send',
      method: 'POST',
    })])
  })

  it('offers explicit accept and destructive decline controls to the recipient of a sent quote', () => {
    expect(commerceChatActions({
      kind: 'quote',
      id: 'quote-1',
      data: {
        orgId: 'sender-org',
        sourceOrgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        status: 'sent',
      },
      perspectiveOrgId: 'recipient-org',
      actorRole: 'member',
    })).toEqual([
      {
        id: 'accept-quote:quote-1',
        label: 'Accept quote',
        href: '/api/v1/quotes/quote-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { status: 'accepted' },
      },
      {
        id: 'decline-quote:quote-1',
        label: 'Decline quote',
        href: '/api/v1/quotes/quote-1',
        method: 'PATCH',
        destructive: true,
        requiresApproval: true,
        body: { status: 'declined' },
      },
    ])
  })

  it('converts an accepted sender quote without exposing payment mutations', () => {
    expect(commerceChatActions({
      kind: 'quote',
      id: 'quote-1',
      data: {
        orgId: 'sender-org',
        sourceOrgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        status: 'accepted',
      },
      perspectiveOrgId: 'sender-org',
      actorRole: 'admin',
    })).toEqual([{
      id: 'convert-quote:quote-1',
      label: 'Convert to invoice',
      href: '/api/v1/quotes/quote-1',
      method: 'PATCH',
      requiresApproval: true,
      body: { action: 'convert-to-invoice' },
    }])

    expect(commerceChatActions({
      kind: 'invoice',
      id: 'invoice-1',
      data: { status: 'payment_pending_verification', paymentProofFileId: 'file-1' },
      perspectiveOrgId: 'sender-org',
      actorRole: 'admin',
      canManageSourceOrg: true,
    })).toEqual([])
  })
})
