const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: mockGet,
      }),
    }),
  },
}))

describe('property chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      exists: true,
      id: 'property-1',
      data: () => ({
        orgId: 'org-1',
        name: 'Ballito Office',
        domain: 'ballito.example',
        type: 'office',
        status: 'active',
        config: { revenue: { timezone: 'Africa/Johannesburg', currency: 'ZAR' } },
        updatedAt: '2026-07-31T07:00:00.000Z',
      }),
    })
  })

  it('returns a specialized property card with live metrics and admin controls', async () => {
    const { propertyChatContextAdapter } = await import('@/lib/chat-context/adapters/property')
    const result = await propertyChatContextAdapter.resolve({
      kind: 'property',
      id: 'property-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      kind: 'property',
      id: 'property-1',
      orgId: 'org-1',
      href: '/admin/properties/property-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'active' },
      { id: 'type', label: 'Type', value: 'office' },
      { id: 'domain', label: 'Domain', value: 'ballito.example' },
      { id: 'currency', label: 'Currency', value: 'ZAR' },
      { id: 'timezone', label: 'Timezone', value: 'Africa/Johannesburg' },
    ]))
    expect(result.model.capabilities).toContain('inline-actions')
    expect(result.model.preview).toEqual(expect.objectContaining({
      kind: 'summary',
      status: 'active',
    }))
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'rotate-property-ingest-key:property-1',
        method: 'POST',
        href: '/api/v1/properties/property-1/rotate-ingest-key',
      }),
      expect.objectContaining({
        id: 'archive-property:property-1',
        method: 'DELETE',
      }),
    ]))
  })

  it('returns not_found for deleted or cross-org properties', async () => {
    const { propertyChatContextAdapter } = await import('@/lib/chat-context/adapters/property')

    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'property-1',
      data: () => ({ orgId: 'org-1', deleted: true, name: 'Archived property' }),
    })
    await expect(propertyChatContextAdapter.resolve({
      kind: 'property',
      id: 'property-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })

    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'property-1',
      data: () => ({ orgId: 'org-2', name: 'Other org property' }),
    })
    await expect(propertyChatContextAdapter.resolve({
      kind: 'property',
      id: 'property-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
