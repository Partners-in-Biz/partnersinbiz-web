const mockGetAccessibleClientDocument = jest.fn()
const mockGetRecentDocumentRows = jest.fn()
const mockPolicyAccess = jest.fn()
const mockSubcollectionGet = jest.fn()

jest.mock('@/lib/chat-context/adapters/generic', () => ({
  genericChatContextAdapter: {
    resolve: jest.fn(async () => ({
      ok: true,
      model: {
        context: {
          kind: 'document',
          id: 'document-1',
          orgId: 'client-org',
          label: 'Launch agreement',
          icon: 'description',
          href: '/portal/documents/document-1?orgId=client-org',
        },
        pulse: { label: 'document', metrics: [] },
        groups: [],
        artifacts: [],
        attention: [],
        activity: [],
        relationships: [{ kind: 'project', id: 'project-1', label: 'Launch project', relation: 'Project' }],
        capabilities: ['open'],
        asOf: '2026-07-31T08:00:00.000Z',
      },
    })),
  },
}))

jest.mock('@/lib/client-documents/access', () => ({
  getAccessibleClientDocument: (...args: unknown[]) => mockGetAccessibleClientDocument(...args),
}))

jest.mock('@/lib/client-documents/indexed-query', () => ({
  getRecentDocumentRows: (...args: unknown[]) => mockGetRecentDocumentRows(...args),
}))

jest.mock('@/lib/organizations/module-policy-access', () => ({
  clientLinkedOrgIdForUser: () => 'client-org',
  assertUserCanPerformOrganizationModuleAction: (...args: unknown[]) => mockPolicyAccess(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          get: () => mockSubcollectionGet(name),
        }),
      }),
    }),
  },
}))

function snapshotRows(rows: Array<{ id: string } & Record<string, unknown>>) {
  return {
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
  }
}

describe('document chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAccessibleClientDocument.mockResolvedValue({
      ok: true,
      document: {
        id: 'document-1',
        orgId: 'holder-org',
        title: 'Launch agreement',
        type: 'sales_proposal',
        templateId: 'sales-proposal',
        status: 'client_review',
        linked: { clientOrgId: 'client-org', projectId: 'project-1' },
        currentVersionId: 'version-2',
        latestPublishedVersionId: 'version-2',
        approvalMode: 'operational',
        clientPermissions: {
          canComment: true,
          canSuggest: true,
          canDirectEdit: false,
          canApprove: true,
        },
        assumptions: [],
        shareToken: 'share-token',
        shareEnabled: true,
        editShareEnabled: false,
        createdBy: 'admin-1',
        createdByType: 'user',
        updatedBy: 'admin-1',
        updatedByType: 'user',
        updatedAt: '2026-07-31T09:00:00.000Z',
        deleted: false,
      },
    })
    mockPolicyAccess.mockResolvedValue({ ok: true })
    mockGetRecentDocumentRows.mockResolvedValue([
      {
        id: 'task-1',
        documentId: 'document-1',
        orgId: 'holder-org',
        title: 'Confirm scope',
        completed: false,
        dueDate: '2026-08-05',
        createdBy: 'admin-1',
      },
    ])
    mockSubcollectionGet.mockImplementation(async (name: string) => {
      if (name === 'comments') {
        return snapshotRows([{
          id: 'comment-1',
          documentId: 'document-1',
          versionId: 'version-2',
          text: 'Confirm the launch date',
          userId: 'client-1',
          userName: 'Client',
          userRole: 'client',
          status: 'open',
          agentPickedUp: false,
          createdAt: '2026-07-31T08:30:00.000Z',
        }])
      }
      if (name === 'suggestions') {
        return snapshotRows([{
          id: 'suggestion-1',
          documentId: 'document-1',
          versionId: 'version-2',
          blockId: 'scope',
          kind: 'replace_text',
          status: 'open',
          createdBy: 'client-1',
        }])
      }
      if (name === 'versions') {
        return snapshotRows([{
          id: 'version-2',
          documentId: 'document-1',
          versionNumber: 2,
          status: 'published',
          blocks: [],
          theme: {},
          createdBy: 'admin-1',
          createdByType: 'user',
        }])
      }
      return snapshotRows([])
    })
  })

  it('projects authoritative review, version and task state with re-authorized inline actions', async () => {
    const { documentChatContextAdapter } = await import('@/lib/chat-context/adapters/document')
    const result = await documentChatContextAdapter.resolve({
      kind: 'document',
      id: 'document-1',
      user: {
        uid: 'client-1',
        role: 'client',
        orgId: 'client-org',
        activeOrgId: 'client-org',
        orgIds: ['client-org'],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual([
      { id: 'status', label: 'Status', value: 'Client Review' },
      { id: 'version', label: 'Current version', value: 2 },
      { id: 'comments', label: 'Open comments', value: 1 },
      { id: 'suggestions', label: 'Open suggestions', value: 1 },
      { id: 'tasks', label: 'Open tasks', value: 1 },
    ])
    expect(result.model.groups.find((group) => group.id === 'review')?.items).toHaveLength(2)
    expect(result.model.groups.find((group) => group.id === 'tasks')?.items[0].actions?.[0]).toMatchObject({
      id: 'complete-document-task:document-1:task-1',
      method: 'PATCH',
      body: { taskId: 'task-1', completed: true },
    })
    expect(result.model.attention.find((item) => item.id === 'operational-approval')?.actions?.[0]).toMatchObject({
      id: 'approve-document:document-1:version-2',
      method: 'POST',
    })
    expect(result.model.relationships).toEqual([
      { kind: 'project', id: 'project-1', label: 'Launch project', relation: 'Project' },
    ])
    expect(result.model.capabilities).toContain('inline-actions')
  })
})
