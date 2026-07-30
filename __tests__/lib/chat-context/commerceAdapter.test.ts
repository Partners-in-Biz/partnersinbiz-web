const mockRecordGet = jest.fn()
const mockResolveContextReferences = jest.fn()
const mockResolveAuth = jest.fn()
const mockCanManageOrg = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({ get: () => mockRecordGet(name, id) }),
    }),
  },
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/billing/crm-record-scope', () => ({
  resolveBillingCrmAuthContext: (...args: unknown[]) => mockResolveAuth(...args),
}))

jest.mock('@/lib/orgMembers/permissions', () => ({
  canManageOrgAs: (...args: unknown[]) => mockCanManageOrg(...args),
}))

describe('commerce chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAuth.mockResolvedValue({
      actor: { uid: 'member-1', displayName: 'Member', kind: 'human' },
      role: 'member',
    })
    mockCanManageOrg.mockResolvedValue(true)
    mockResolveContextReferences.mockImplementation(async (seeds: Array<{ type: string; id: string }>) => {
      const seed = seeds[0]
      if (seed.type === 'invoice' || seed.type === 'quote') {
        return [{
          type: seed.type,
          id: seed.id,
          orgId: seed.type === 'quote' ? 'recipient-org' : 'sender-org',
          label: seed.type === 'quote' ? 'Q-001' : 'INV-001',
          origin: 'manual',
        }]
      }
      return []
    })
  })

  it('projects a live invoice and its confirmed canonical send command', async () => {
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'invoice-1',
      data: () => ({
        orgId: 'sender-org',
        sourceOrgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        invoiceNumber: 'INV-001',
        status: 'draft',
        total: 12500,
        currency: 'ZAR',
        dueDate: { seconds: 1785542400 },
        clientDetails: { email: 'buyer@example.com' },
        updatedAt: '2026-07-31T09:00:00.000Z',
      }),
    })

    const { commerceChatContextAdapter } = await import('@/lib/chat-context/adapters/commerce')
    const result = await commerceChatContextAdapter.resolve({
      kind: 'invoice',
      id: 'invoice-1',
      user: { uid: 'member-1', role: 'client', activeOrgId: 'sender-org', orgId: 'sender-org' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toMatchObject({ kind: 'invoice', id: 'invoice-1', label: 'INV-001', orgId: 'sender-org' })
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'Draft' },
      expect.objectContaining({ id: 'total', label: 'Total' }),
    ]))
    expect(result.model.groups[0].items[0].actions).toEqual([
      expect.objectContaining({ id: 'send-invoice:invoice-1', href: '/api/v1/invoices/invoice-1/send' }),
    ])
  })

  it('projects recipient quote decision actions and attention', async () => {
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'quote-1',
      data: () => ({
        orgId: 'sender-org',
        sourceOrgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        quoteNumber: 'Q-001',
        status: 'sent',
        total: 32000,
        currency: 'ZAR',
        validUntil: { _seconds: 1786147200 },
      }),
    })

    const { commerceChatContextAdapter } = await import('@/lib/chat-context/adapters/commerce')
    const result = await commerceChatContextAdapter.resolve({
      kind: 'quote',
      id: 'quote-1',
      user: { uid: 'member-1', role: 'client', activeOrgId: 'recipient-org', orgId: 'recipient-org' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context.orgId).toBe('recipient-org')
    expect(result.model.attention[0]).toMatchObject({
      id: 'quote-decision',
      state: 'needs_approval',
    })
    expect(result.model.groups[0].items[0].actions).toEqual([
      expect.objectContaining({ id: 'accept-quote:quote-1' }),
      expect.objectContaining({ id: 'decline-quote:quote-1', destructive: true }),
    ])
  })

  it('shows payment-proof review without guessing payment details', async () => {
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'invoice-1',
      data: () => ({
        orgId: 'sender-org',
        recipientOrgId: 'recipient-org',
        invoiceNumber: 'INV-001',
        status: 'payment_pending_verification',
        total: 1000,
        currency: 'ZAR',
      }),
    })

    const { commerceChatContextAdapter } = await import('@/lib/chat-context/adapters/commerce')
    const result = await commerceChatContextAdapter.resolve({
      kind: 'invoice',
      id: 'invoice-1',
      user: { uid: 'member-1', role: 'client', activeOrgId: 'sender-org', orgId: 'sender-org' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.attention[0]).toMatchObject({
      id: 'payment-proof-review',
      state: 'needs_approval',
    })
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
  })

  it('fails closed when the live record no longer includes the authorised perspective', async () => {
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'invoice-1',
      data: () => ({ orgId: 'other-org', invoiceNumber: 'Hidden', status: 'draft' }),
    })

    const { commerceChatContextAdapter } = await import('@/lib/chat-context/adapters/commerce')
    await expect(commerceChatContextAdapter.resolve({
      kind: 'invoice',
      id: 'invoice-1',
      user: { uid: 'member-1', role: 'client', activeOrgId: 'sender-org', orgId: 'sender-org' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    expect(mockResolveAuth).not.toHaveBeenCalled()
  })
})
