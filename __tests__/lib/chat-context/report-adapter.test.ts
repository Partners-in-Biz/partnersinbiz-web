const mockGet = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: mockGet,
      }),
    }),
  },
}))

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

describe('report chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      exists: true,
      id: 'report-1',
      data: () => ({
        orgId: 'org-1',
        status: 'sent',
        category: 'sales',
        period: { start: '2026-06-01', end: '2026-06-30' },
        kpis: { sessions: 120, users: 40, invoiced_revenue: 12345 },
        exec_summary: 'Strong sales this month',
        propertyId: 'property-1',
        updatedAt: '2026-07-31T06:00:00.000Z',
      }),
    })
    mockResolveContextReferences.mockResolvedValue([{
      type: 'property',
      id: 'property-1',
      label: 'Ballito Office',
      href: '/admin/properties/property-1',
    }])
  })

  it('returns a specialized report card with metrics and linked property', async () => {
    const { reportChatContextAdapter } = await import('@/lib/chat-context/adapters/report')
    const result = await reportChatContextAdapter.resolve({
      kind: 'report',
      id: 'report-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      kind: 'report',
      id: 'report-1',
      label: expect.stringContaining('2026-06-01 to 2026-06-30'),
      href: '/admin/reports/report-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'sent' },
      { id: 'category', label: 'Category', value: 'sales' },
      { id: 'period', label: 'Period', value: '2026-06-01 - 2026-06-30' },
      expect.objectContaining({ id: 'invoiced-revenue', label: 'Invoiced revenue', value: 12345 }),
      expect.objectContaining({ id: 'sessions', label: 'Sessions', value: 120 }),
      expect.objectContaining({ id: 'users', label: 'Users', value: 40 }),
    ]))
    expect(result.model.preview).toEqual(expect.objectContaining({
      kind: 'summary',
      status: 'sent',
    }))
    expect(result.model.relationships).toEqual([{
      kind: 'property',
      id: 'property-1',
      label: 'Ballito Office',
      relation: 'Property',
      href: '/admin/properties/property-1',
    }])
    expect(result.model.capabilities).toContain('inline-actions')
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'disable-report-link:report-1',
        method: 'DELETE',
      }),
    ]))
  })

  it('returns not_found for unauthorised roles/org combinations', async () => {
    const { reportChatContextAdapter } = await import('@/lib/chat-context/adapters/report')

    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'report-1',
      data: () => ({ orgId: 'org-2', status: 'draft' }),
    })
    await expect(reportChatContextAdapter.resolve({
      kind: 'report',
      id: 'report-1',
      user: { uid: 'client-1', role: 'client', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })

    mockGet.mockResolvedValueOnce({ exists: false })
    await expect(reportChatContextAdapter.resolve({
      kind: 'report',
      id: 'missing',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
