const mockBatchCommit = jest.fn()
const mockBatchSet = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockRunTransaction = jest.fn()
const mockPlanningBlocker = jest.fn()
const mockPreparePlanningTransition = jest.fn()
const mockStartPlanningTransition = jest.fn()
const mockResolveProjectAccessForUser = jest.fn()

const versionRef = { id: 'version-1' }
const documentRef = { id: 'doc-1', collection: jest.fn(() => ({ doc: jest.fn(() => versionRef) })) }
const planningEventRef = { id: 'event-1' }
const projectRef = { id: 'project-1', collection: jest.fn(() => ({ doc: jest.fn(() => planningEventRef) })) }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => ({ doc: jest.fn(() => name === 'projects' ? projectRef : documentRef) })),
    batch: jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  },
}))

jest.mock('@/lib/projects/planningDiscovery', () => ({
  planningMutationBlocker: (...args: unknown[]) => mockPlanningBlocker(...args),
  preparePlanningContextMutation: (...args: unknown[]) => mockPreparePlanningTransition(...args),
  applyPlanningDiscoveryAction: (...args: unknown[]) => mockStartPlanningTransition(...args),
}))

jest.mock('@/lib/projects/collaboration', () => {
  const actual = jest.requireActual('@/lib/projects/collaboration')
  return {
    ...actual,
    resolveProjectAccessForUser: (...args: unknown[]) => mockResolveProjectAccessForUser(...args),
  }
})

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveProjectAccessForUser.mockResolvedValue({
    role: 'manager',
    source: 'project_member',
    canViewInternal: true,
  })
  mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', planningDiscovery: { enforced: true } }) })
  mockPlanningBlocker.mockReturnValue(null)
  mockPreparePlanningTransition.mockImplementation((_project: unknown, input: { reason: string; reopenWhenReady?: boolean }) => input.reopenWhenReady === false
    ? { allowed: true }
    : {
        allowed: true,
        state: { enforced: true, status: 'interviewing', staleReason: input.reason },
        event: { type: 'reopened' },
      })
  mockStartPlanningTransition.mockReturnValue({
    ok: true,
    state: { enforced: true, status: 'interviewing', revision: 1 },
    event: { type: 'started' },
  })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
  }))
})

it('creates a project-linked client document without reopening the confirmed brief', async () => {
  const { createClientDocument } = await import('@/lib/client-documents/store')

  const created = await createClientDocument({
    title: 'Project requirements',
    type: 'build_spec',
    orgId: 'org-1',
    linked: { projectId: 'project-1' },
    user: { uid: 'admin-1', role: 'admin' },
  })

  expect(created).toEqual(expect.objectContaining({ id: 'doc-1', versionId: 'version-1' }))
  expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
  expect(mockResolveProjectAccessForUser).toHaveBeenCalledWith(
    'project-1',
    expect.objectContaining({ uid: 'admin-1' }),
    expect.objectContaining({ orgId: 'org-1' }),
    'org-1',
    { action: 'project.write' },
  )
  expect(mockTransactionSet).toHaveBeenCalledWith(documentRef, expect.objectContaining({ title: 'Project requirements' }))
  expect(mockTransactionSet).toHaveBeenCalledWith(versionRef, expect.objectContaining({ documentId: 'doc-1' }))
  expect(mockTransactionUpdate).not.toHaveBeenCalledWith(projectRef, expect.objectContaining({
    planningDiscovery: expect.anything(),
  }))
  expect(mockTransactionSet).not.toHaveBeenCalledWith(planningEventRef, expect.anything())
  expect(mockBatchCommit).not.toHaveBeenCalled()
})

it('initializes discovery and fails closed before creating a project-linked client document', async () => {
  mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1' }) })
  mockPlanningBlocker.mockReturnValue({ code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 })
  const { createClientDocument } = await import('@/lib/client-documents/store')

  await expect(createClientDocument({
    title: 'Blocked requirements',
    type: 'build_spec',
    orgId: 'org-1',
    linked: { projectId: 'project-1' },
    user: { uid: 'admin-1', role: 'admin' },
  })).rejects.toMatchObject({ status: 409, details: expect.objectContaining({ code: 'planning_discovery_required' }) })

  expect(mockTransactionSet).not.toHaveBeenCalledWith(documentRef, expect.anything())
  expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
    planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing' }),
  }))
  expect(mockTransactionSet).toHaveBeenCalledWith(planningEventRef, expect.objectContaining({
    projectId: 'project-1',
    type: 'started',
  }))
})

it('does not disclose or mutate a linked project outside the caller tenant', async () => {
  mockResolveProjectAccessForUser.mockResolvedValue(null)
  mockTransactionGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-2', planningDiscovery: { enforced: true } }),
  })
  const { createClientDocument } = await import('@/lib/client-documents/store')

  await expect(createClientDocument({
    title: 'Cross-tenant attempt',
    type: 'build_spec',
    orgId: 'org-1',
    linked: { projectId: 'project-1' },
    user: { uid: 'admin-1', role: 'admin', orgId: 'org-1', allowedOrgIds: ['org-1'] },
  })).rejects.toMatchObject({
    status: 403,
    details: expect.objectContaining({ code: 'project_access_denied' }),
  })

  expect(mockTransactionSet).not.toHaveBeenCalledWith(documentRef, expect.anything())
  expect(mockTransactionUpdate).not.toHaveBeenCalledWith(projectRef, expect.anything())
  expect(mockTransactionSet).not.toHaveBeenCalledWith(planningEventRef, expect.anything())
})

it('rejects a read-only external collaborator before creating a project-linked client document', async () => {
  mockResolveProjectAccessForUser.mockResolvedValue({
    role: 'viewer',
    source: 'project_organization',
    canViewInternal: false,
    crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: [] },
  })
  const { createClientDocument } = await import('@/lib/client-documents/store')

  await expect(createClientDocument({
    title: 'Unauthorized linked document',
    type: 'build_spec',
    orgId: 'external-org',
    linked: { projectId: 'project-1' },
    user: { uid: 'external-1', role: 'admin', orgId: 'external-org' },
  })).rejects.toMatchObject({
    status: 403,
    details: expect.objectContaining({ code: 'project_access_denied' }),
  })

  expect(mockResolveProjectAccessForUser).toHaveBeenCalledWith(
    'project-1',
    expect.objectContaining({ uid: 'external-1' }),
    expect.anything(),
    'external-org',
    { action: 'project.write' },
  )
  expect(mockTransactionSet).not.toHaveBeenCalledWith(documentRef, expect.anything())
})
