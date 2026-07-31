const mockProductGet = jest.fn()
const mockMembershipGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'product',
          id: 'product-1',
          orgId: 'org-1',
          label: 'Growth retainer',
          icon: 'inventory_2',
          href: '/portal/settings/products',
        },
        pulse: { label: 'product', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        capabilities: ['open'],
        asOf: '2026-07-31T09:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({
        get: name === 'products' ? mockProductGet : mockMembershipGet,
      }),
    }),
  },
}))

describe('product chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProductGet.mockResolvedValue({
      exists: true,
      id: 'product-1',
      data: () => ({
        orgId: 'org-1',
        name: 'Growth retainer',
        description: 'Monthly growth operations',
        unitPrice: 15000,
        currency: 'ZAR',
        unit: 'month',
        active: true,
        updatedAt: '2026-07-31T10:00:00.000Z',
        updatedByRef: { displayName: 'Peet' },
      }),
    })
    mockMembershipGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', status: 'active' }),
    })
  })

  it('projects live price, readiness, activity, exact links, and manager controls', async () => {
    const { productChatContextAdapter } = await import('@/lib/chat-context/adapters/product')
    const result = await productChatContextAdapter.resolve({
      kind: 'product',
      id: 'product-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'Active' },
      { id: 'unit', label: 'Unit', value: 'month' },
      { id: 'readiness', label: 'Quote readiness', value: '100%' },
    ]))
    expect(result.model.context.href).toBe('/portal/settings/products?product=product-1&orgId=org-1')
    expect(result.model.groups[0].items[0].actions).toEqual([
      expect.objectContaining({ id: 'deactivate-product:product-1' }),
    ])
    expect(result.model.activity).toEqual([
      expect.objectContaining({ id: 'product-updated', actorLabel: 'Peet' }),
    ])
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('surfaces quote-readiness gaps without giving an ordinary member lifecycle controls', async () => {
    mockProductGet.mockResolvedValue({
      exists: true,
      id: 'product-1',
      data: () => ({
        orgId: 'org-1',
        name: 'Strategy workshop',
        description: '',
        unitPrice: 0,
        currency: 'ZAR',
        unit: '',
        active: true,
      }),
    })
    mockMembershipGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'member', status: 'active' }),
    })
    const { productChatContextAdapter } = await import('@/lib/chat-context/adapters/product')
    const result = await productChatContextAdapter.resolve({
      kind: 'product',
      id: 'product-1',
      user: {
        uid: 'member-1',
        role: 'client',
        orgId: 'org-1',
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.attention).toEqual([
      expect.objectContaining({
        id: 'product-readiness',
        state: 'blocked',
        detail: 'Missing description, unit, price.',
      }),
    ])
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
  })

  it('fails closed when the member has no CRM module grant', async () => {
    mockMembershipGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'member',
        status: 'active',
        accessPolicy: {
          preset: 'custom',
          modules: { messages: true, crm: false },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        },
      }),
    })
    const { productChatContextAdapter } = await import('@/lib/chat-context/adapters/product')
    const result = await productChatContextAdapter.resolve({
      kind: 'product',
      id: 'product-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })

    expect(result).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
  })
})
