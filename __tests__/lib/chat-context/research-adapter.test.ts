const mockGetResearchItem = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/research/store', () => ({
  getResearchItem: (...args: unknown[]) => mockGetResearchItem(...args),
}))

describe('research chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetResearchItem.mockResolvedValue({
      id: 'research-1',
      orgId: 'org-1',
      deleted: false,
      title: 'Landing page audit',
      kind: 'site',
      status: 'review',
      visibility: 'internal',
      summary: 'Review in progress summary',
      notesMarkdown: 'Needs follow-up',
      findings: [
        { id: 'finding-1', title: 'Missing meta', status: 'open' },
        { id: 'finding-2', title: 'Slow load', status: 'closed' },
      ],
      recommendations: [
        { id: 'recommendation-1', title: 'Add canonical', status: 'open' },
        { id: 'recommendation-2', title: 'Optimize images', status: 'open' },
      ],
      linked: {
        projectId: 'project-1',
        propertyId: 'property-1',
      },
      updatedAt: '2026-07-31T08:00:00.000Z',
    })
    mockResolveContextReferences.mockResolvedValue([
      { type: 'project', id: 'project-1', label: 'Campaign Alpha', href: '/admin/projects/project-1' },
      { type: 'property', id: 'property-1', label: 'Ballito Office', href: '/admin/properties/property-1' },
    ])
  })

  it('returns a reviewed research card with findings/recommendations counts and actions for admin', async () => {
    const { researchChatContextAdapter } = await import('@/lib/chat-context/adapters/research')
    const result = await researchChatContextAdapter.resolve({
      kind: 'research',
      id: 'research-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      kind: 'research',
      id: 'research-1',
      orgId: 'org-1',
      label: 'Landing page audit',
      href: '/admin/research/research-1',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'status', label: 'Status', value: 'review' },
      { id: 'visibility', label: 'Visibility', value: 'internal' },
      { id: 'kind', label: 'Kind', value: 'site' },
      { id: 'findings', label: 'Findings', value: 2 },
      { id: 'open-findings', label: 'Open findings', value: 1 },
      { id: 'recommendations', label: 'Recommendations', value: 2 },
      { id: 'open-recommendations', label: 'Open recommendations', value: 2 },
    ]))
    expect(result.model.preview).toEqual(expect.objectContaining({
      kind: 'summary',
      status: 'review',
      text: 'Review in progress summary',
    }))
    expect(result.model.capabilities).toContain('inline-actions')
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'create-research-document:research-1', method: 'POST' }),
      expect.objectContaining({ id: 'export-research-obsidian:research-1', method: 'POST' }),
      expect.objectContaining({ id: 'archive-research:research-1', method: 'DELETE' }),
    ]))
    expect(result.model.relationships).toEqual([
      { kind: 'project', id: 'project-1', label: 'Campaign Alpha', relation: 'Related', href: '/admin/projects/project-1' },
      { kind: 'property', id: 'property-1', label: 'Ballito Office', relation: 'Related', href: '/admin/properties/property-1' },
    ])
    expect(mockGetResearchItem).toHaveBeenCalledWith('research-1', 'org-1')
  })

  it('returns a read-only view for members and hides write actions', async () => {
    const { researchChatContextAdapter } = await import('@/lib/chat-context/adapters/research')
    const result = await researchChatContextAdapter.resolve({
      kind: 'research',
      id: 'research-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.capabilities).not.toContain('inline-actions')
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
  })

  it('fails closed for unauthorized orgs and deleted items', async () => {
    const { researchChatContextAdapter } = await import('@/lib/chat-context/adapters/research')

    mockGetResearchItem.mockResolvedValueOnce({
      id: 'research-1', orgId: 'org-2', deleted: false, title: 'Other research',
    })
    await expect(researchChatContextAdapter.resolve({
      kind: 'research',
      id: 'research-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })

    mockGetResearchItem.mockResolvedValueOnce({
      id: 'research-1', orgId: 'org-1', deleted: true, title: 'Archived research',
    })
    await expect(researchChatContextAdapter.resolve({
      kind: 'research',
      id: 'research-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
