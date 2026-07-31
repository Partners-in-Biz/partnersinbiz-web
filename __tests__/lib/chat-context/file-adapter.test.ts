const mockGet = jest.fn()
const mockResolveContextReferences = jest.fn()

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: mockGet,
      }),
    }),
  },
}))

describe('file chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      exists: true,
      id: 'file-1',
      data: () => ({
        orgId: 'org-1',
        name: 'Research brief',
        mimeType: 'application/pdf',
        size: 4096,
        folder: 'Research',
        relatedTo: { type: 'project', id: 'project-1' },
        updatedAt: '2026-07-31T09:00:00.000Z',
        deleted: false,
      }),
    })
    mockResolveContextReferences.mockResolvedValue([{
      type: 'project',
      id: 'project-1',
      label: 'Campaign Alpha',
      relation: 'Project',
      href: '/admin/projects/project-1',
    }])
  })

  it('returns an admin-capable file model with normalized hrefs, actions, and related project', async () => {
    const { fileChatContextAdapter } = await import('@/lib/chat-context/adapters/file')
    const result = await fileChatContextAdapter.resolve({
      kind: 'file',
      id: 'file-1',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toEqual(expect.objectContaining({
      kind: 'file',
      id: 'file-1',
      orgId: 'org-1',
      label: 'Research brief',
    }))
    expect(result.model.preview).toEqual(expect.objectContaining({
      kind: 'document',
      text: 'Research brief',
    }))
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      { id: 'type', label: 'MIME', value: 'application/pdf' },
      { id: 'folder', label: 'Folder', value: 'Research' },
      { id: 'size', label: 'Size', value: '4096 B' },
    ]))
    expect(result.model.capabilities).toContain('inline-actions')
    expect(result.model.groups[0].items[0].actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'archive-file:file-1',
        href: '/api/v1/files/file-1',
        method: 'DELETE',
      }),
    ]))
    expect(result.model.relationships).toEqual([{
      kind: 'project',
      id: 'project-1',
      label: 'Campaign Alpha',
      relation: 'Source',
      href: '/admin/projects/project-1',
    }])
  })

  it('fails closed for missing records and wrong org', async () => {
    const { fileChatContextAdapter } = await import('@/lib/chat-context/adapters/file')

    mockGet.mockResolvedValueOnce({ exists: false })
    await expect(fileChatContextAdapter.resolve({
      kind: 'file',
      id: 'missing',
      user: { uid: 'admin-1', role: 'admin', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })

    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'file-1',
      data: () => ({ orgId: 'org-2', name: 'Other org file' }),
    })
    await expect(fileChatContextAdapter.resolve({
      kind: 'file',
      id: 'file-1',
      user: { uid: 'member-1', role: 'client', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found' })
  })
})
