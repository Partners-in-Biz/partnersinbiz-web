const mockRecordGet = jest.fn()
const mockGenericResolve = jest.fn()
const mockResolveAuth = jest.fn()
const mockLoadPipeline = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () => mockRecordGet(name, id),
      }),
    }),
  },
}))

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: { resolve: (...args: unknown[]) => mockGenericResolve(...args) },
}))

jest.mock('@/lib/billing/crm-record-scope', () => ({
  resolveBillingCrmAuthContext: (...args: unknown[]) => mockResolveAuth(...args),
}))

jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: (...args: unknown[]) => mockLoadPipeline(...args),
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

function baseModel(kind: 'contact' | 'company' | 'deal', id: string) {
  return {
    context: {
      kind,
      id,
      orgId: 'org-1',
      label: 'Canonical record',
      icon: kind === 'deal' ? 'handshake' : kind === 'company' ? 'domain' : 'person',
      href: `/admin/crm/${kind}/${id}`,
    },
    pulse: { label: kind, metrics: [] },
    groups: [],
    artifacts: [],
    attention: [],
    activity: [{ id: 'updated', type: 'running', label: 'Updated', occurredAt: '2026-07-31T08:00:00.000Z' }],
    capabilities: ['open'],
    asOf: '2026-07-31T08:00:00.000Z',
  }
}

describe('CRM chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAuth.mockResolvedValue({
      actor: { uid: 'admin-1', displayName: 'Admin', kind: 'human' },
      role: 'admin',
    })
    mockResolveContextReferences.mockResolvedValue([])
  })

  it('projects live contact data and authoritative admin actions', async () => {
    mockGenericResolve.mockResolvedValue({ ok: true, model: baseModel('contact', 'contact-1') })
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'contact-1',
      data: () => ({
        orgId: 'org-1',
        name: 'Ada Buyer',
        email: 'ada@example.com',
        companyName: 'Acme',
        stage: 'new',
        type: 'lead',
        leadScore: 82,
        assignedTo: 'admin-1',
        assignedToRef: { displayName: 'Admin' },
        updatedAt: '2026-07-31T08:00:00.000Z',
      }),
    })

    const { crmChatContextAdapter } = await import('@/lib/chat-context/adapters/crm')
    const result = await crmChatContextAdapter.resolve({
      kind: 'contact',
      id: 'contact-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'stage', label: 'Stage', value: 'New' },
      { id: 'lead-score', label: 'Lead score', value: 82 },
    ]))
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'advance-crm-contact:contact-1:contacted', body: { stage: 'contacted' } }),
      expect.objectContaining({ id: 'score-crm-contact:contact-1', body: { includeAi: true } }),
    ]))
    expect(result.model.activity).toHaveLength(1)
    expect(result.model.capabilities).toContain('inline-actions')
  })

  it('keeps a CRM viewer read-only while preserving live preview data', async () => {
    mockGenericResolve.mockResolvedValue({ ok: true, model: baseModel('company', 'company-1') })
    mockResolveAuth.mockResolvedValue({
      actor: { uid: 'viewer-1', displayName: 'Viewer', kind: 'human' },
      role: 'viewer',
    })
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'company-1',
      data: () => ({ orgId: 'org-1', name: 'Acme', lifecycleStage: 'prospect', healthScore: 74 }),
    })

    const { crmChatContextAdapter } = await import('@/lib/chat-context/adapters/crm')
    const result = await crmChatContextAdapter.resolve({
      kind: 'company',
      id: 'company-1',
      user: { uid: 'viewer-1', role: 'client', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'health-score', label: 'Health score', value: 74 },
    ]))
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).not.toContain('inline-actions')
  })

  it('uses pipeline order and never offers terminal deal movement', async () => {
    mockGenericResolve.mockResolvedValue({ ok: true, model: baseModel('deal', 'deal-1') })
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'deal-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Expansion',
        ownerUid: 'admin-1',
        pipelineId: 'pipeline-1',
        stageId: 'proposal',
        value: 125000,
        currency: 'ZAR',
      }),
    })
    mockLoadPipeline.mockResolvedValue({
      data: {
        id: 'pipeline-1',
        name: 'Sales',
        stages: [
          { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
          { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 50 },
          { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
          { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
        ],
      },
    })

    const { crmChatContextAdapter } = await import('@/lib/chat-context/adapters/crm')
    const result = await crmChatContextAdapter.resolve({
      kind: 'deal',
      id: 'deal-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'stage', label: 'Stage', value: 'Proposal' },
      expect.objectContaining({ id: 'value', label: 'Value' }),
    ]))
    expect(String(result.model.pulse.metrics.find((metric) => metric.id === 'value')?.value))
      .toMatch(/^ZAR 125\D?000$/)
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).not.toContain('inline-actions')
  })

  it('fails closed when the live document no longer matches the authorised organisation', async () => {
    mockGenericResolve.mockResolvedValue({ ok: true, model: baseModel('contact', 'contact-1') })
    mockRecordGet.mockResolvedValue({
      exists: true,
      id: 'contact-1',
      data: () => ({ orgId: 'org-other', name: 'Hidden' }),
    })

    const { crmChatContextAdapter } = await import('@/lib/chat-context/adapters/crm')
    await expect(crmChatContextAdapter.resolve({
      kind: 'contact',
      id: 'contact-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found', status: 404 })
    expect(mockResolveAuth).not.toHaveBeenCalled()
  })
})
