import { NextRequest } from 'next/server'

const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockRunTransaction = jest.fn()
const mockPlanningBlocker = jest.fn()
const mockPreparePlanningTransition = jest.fn()
const mockStartPlanningTransition = jest.fn()
const mockResolveProjectAccessForUser = jest.fn()

const documentRef = { id: 'doc-1', path: 'client_documents/doc-1' }
const planningEventRef = { id: 'event-1', path: 'projects/project-1/planningDiscoveryEvents/event-1' }
const projectRef = {
  id: 'project-1',
  path: 'projects/project-1',
  collection: jest.fn(() => ({ doc: jest.fn(() => planningEventRef) })),
}
const user = { uid: 'admin-1', role: 'admin' as const, orgId: 'org-1', authKind: 'session' as const }
const restrictedAdmin = {
  uid: 'admin-2', role: 'admin' as const, orgId: 'org-1', allowedOrgIds: ['org-1'], authKind: 'session' as const,
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => name === 'projects' ? projectRef : documentRef),
    })),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

jest.mock('@/lib/client-documents/access', () => ({
  assertClientDocumentDataAccess: jest.fn(() => ({ ok: true })),
  canManageClientDocument: jest.fn(() => true),
  getAccessibleClientDocument: jest.fn(),
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
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === documentRef) {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', title: 'Requirements', deleted: false, linked: { projectId: 'project-1' } }),
      }
    }
    if (ref === projectRef) return { exists: true, data: () => ({ orgId: 'org-1', planningDiscovery: { enforced: true } }) }
    throw new Error('Unexpected transaction read')
  })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
  }))
  mockPlanningBlocker.mockReturnValue(null)
  mockPreparePlanningTransition.mockImplementation((_project: unknown, _actor: unknown, reason: string) => ({
    ok: true,
    state: { enforced: true, status: 'interviewing', staleReason: reason },
    event: { type: 'reopened' },
  }))
  mockStartPlanningTransition.mockReturnValue({
    ok: true,
    state: { enforced: true, status: 'interviewing', revision: 1 },
    event: { type: 'started' },
  })
})

const ctx = { params: Promise.resolve({ id: 'doc-1' }) }

it('atomically invalidates the linked project when a client document changes', async () => {
  const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
  const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Updated requirements' }),
  })

  const res = await PATCH(req, user, ctx)

  expect(res.status).toBe(200)
  expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
  expect(mockTransactionUpdate).toHaveBeenCalledWith(documentRef, expect.objectContaining({ title: 'Updated requirements' }))
  expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
    planningDiscovery: expect.objectContaining({ staleReason: 'client_document.updated' }),
  }))
  expect(mockTransactionSet).toHaveBeenCalledWith(planningEventRef, expect.objectContaining({
    projectId: 'project-1',
    reason: 'client_document.updated',
  }))
})

it('atomically invalidates the linked project when a client document is deleted', async () => {
  const { DELETE } = await import('@/app/api/v1/client-documents/[id]/route')
  const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1', { method: 'DELETE' })

  const res = await DELETE(req, user, ctx)

  expect(res.status).toBe(200)
  expect(mockTransactionUpdate).toHaveBeenCalledWith(documentRef, expect.objectContaining({ deleted: true }))
  expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
    planningDiscovery: expect.objectContaining({ staleReason: 'client_document.deleted' }),
  }))
  expect(mockTransactionSet).toHaveBeenCalledWith(planningEventRef, expect.objectContaining({
    projectId: 'project-1',
    reason: 'client_document.deleted',
  }))
})

it('initializes discovery and blocks a linked document mutation on a legacy project', async () => {
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === documentRef) {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', title: 'Requirements', deleted: false, linked: { projectId: 'project-1' } }),
      }
    }
    if (ref === projectRef) return { exists: true, data: () => ({ orgId: 'org-1' }) }
    throw new Error('Unexpected transaction read')
  })
  mockPlanningBlocker.mockReturnValue({ code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 })
  const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
  const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Blocked requirements' }),
  })

  const res = await PATCH(req, user, ctx)

  expect(res.status).toBe(409)
  expect(mockTransactionUpdate).not.toHaveBeenCalledWith(documentRef, expect.anything())
  expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
    planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing' }),
  }))
  expect(mockTransactionSet).toHaveBeenCalledWith(planningEventRef, expect.objectContaining({
    projectId: 'project-1',
    type: 'started',
  }))
})

it('rejects a newly linked project outside the caller tenant without disclosing planning state', async () => {
  mockResolveProjectAccessForUser.mockResolvedValue(null)
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === documentRef) return { exists: true, data: () => ({ orgId: 'org-1', title: 'Requirements', deleted: false }) }
    if (ref === projectRef) {
      return { exists: true, data: () => ({ orgId: 'org-2', planningDiscovery: { enforced: true } }) }
    }
    throw new Error('Unexpected transaction read')
  })
  const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')

  const res = await PATCH(new NextRequest('http://localhost/api/v1/client-documents/doc-1', {
    method: 'PATCH',
    body: JSON.stringify({ linked: { projectId: 'project-1' } }),
    headers: { 'Content-Type': 'application/json' },
  }), restrictedAdmin, { params: Promise.resolve({ id: 'doc-1' }) })
  const body = await res.json()

  expect(res.status).toBe(403)
  expect(body).toEqual(expect.objectContaining({ error: 'Linked project is not accessible' }))
  expect(body).not.toHaveProperty('revision')
  expect(mockTransactionUpdate).not.toHaveBeenCalled()
  expect(mockTransactionSet).not.toHaveBeenCalled()
})

it('rejects an existing foreign project link on delete without mutating it', async () => {
  mockResolveProjectAccessForUser.mockResolvedValue(null)
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === documentRef) {
      return {
        exists: true,
        data: () => ({ orgId: 'org-1', title: 'Requirements', deleted: false, linked: { projectId: 'project-1' } }),
      }
    }
    if (ref === projectRef) return { exists: true, data: () => ({ orgId: 'org-2' }) }
    throw new Error('Unexpected transaction read')
  })
  const { DELETE } = await import('@/app/api/v1/client-documents/[id]/route')

  const res = await DELETE(
    new NextRequest('http://localhost/api/v1/client-documents/doc-1', { method: 'DELETE' }),
    restrictedAdmin,
    { params: Promise.resolve({ id: 'doc-1' }) },
  )

  expect(res.status).toBe(403)
  expect(mockTransactionUpdate).not.toHaveBeenCalled()
  expect(mockTransactionSet).not.toHaveBeenCalled()
})

it('rejects a read-only external collaborator before mutating a project-linked client document', async () => {
  mockResolveProjectAccessForUser.mockResolvedValue({
    role: 'viewer',
    source: 'project_organization',
    canViewInternal: false,
    crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: [] },
  })
  const { PATCH } = await import('@/app/api/v1/client-documents/[id]/route')
  const req = new NextRequest('http://localhost/api/v1/client-documents/doc-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Unauthorized external edit' }),
  })

  const res = await PATCH(req, user, ctx)

  expect(res.status).toBe(403)
  expect(mockResolveProjectAccessForUser).toHaveBeenCalledWith(
    'project-1',
    user,
    expect.objectContaining({ orgId: 'org-1' }),
    'org-1',
    { action: 'project.write', item: 'doc-1' },
  )
  expect(mockTransactionUpdate).not.toHaveBeenCalledWith(documentRef, expect.anything())
})
