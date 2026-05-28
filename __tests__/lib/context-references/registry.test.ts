const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: jest.fn(async (projectId: string) => ({
    ok: true,
    doc: {
      id: projectId,
      data: () => ({
        orgId: 'org-1',
        name: 'Launch Project',
        status: 'development',
        description: 'Build the launch project workspace.',
      }),
    },
    projectAccess: null,
  })),
}))

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, exists: true }
}

function queryFor(docs: Array<ReturnType<typeof doc>>) {
  return {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(async () => ({ docs })),
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => docs.find((item) => item.id === id) ?? { id, exists: false, data: () => ({}) }),
      collection: jest.fn(() => queryFor([])),
    })),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockImplementation((name: string) => {
    if (name === 'contacts') {
      return queryFor([
        doc('contact-1', {
          orgId: 'org-1',
          name: 'Jane Client',
          email: 'jane@example.com',
          company: 'Client Co',
          notes: 'Interested in launch planning.',
          deleted: false,
        }),
        doc('other-contact', {
          orgId: 'org-2',
          name: 'Blocked Contact',
          email: 'blocked@example.com',
          deleted: false,
        }),
      ])
    }
    if (name === 'research_items') {
      return queryFor([
        doc('research-1', {
          orgId: 'org-1',
          title: 'Internal Research',
          summary: 'Internal-only evidence.',
          visibility: 'internal',
          deleted: false,
        }),
      ])
    }
    return queryFor([])
  })
})

describe('context reference registry', () => {
  it('resolves exact references into compact context with ids and labels', async () => {
    const { resolveContextReferences, buildAttachedContextBlock } = await import('@/lib/context-references/registry')

    const refs = await resolveContextReferences([
      { type: 'project', id: 'project-1', orgId: 'org-1', origin: 'current_page' },
      { type: 'contact', id: 'contact-1', orgId: 'org-1', origin: 'mention' },
    ], {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'session',
    })

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project', summary: expect.stringContaining('development') }),
      expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client', summary: expect.stringContaining('jane@example.com') }),
    ]))
    expect(buildAttachedContextBlock(refs)).toContain('[Attached context]')
    expect(buildAttachedContextBlock(refs)).toContain('project: Launch Project')
    expect(buildAttachedContextBlock(refs)).toContain('id: project-1')
  })

  it('searches only references visible to the caller and hides internal research from clients', async () => {
    const { searchContextReferences } = await import('@/lib/context-references/registry')

    await expect(searchContextReferences({
      type: 'research',
      query: 'internal',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' },
    })).resolves.toEqual([])

    await expect(searchContextReferences({
      type: 'contact',
      query: 'jane',
      orgId: 'org-1',
      limit: 8,
      user: { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'], authKind: 'session' },
    })).resolves.toEqual([
      expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' }),
    ])
  })
})
