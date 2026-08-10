import { NextRequest } from 'next/server'
import { planningDiscoveryDigest, type PlanningDecisionBrief, type PlanningDiscoveryState } from '@/lib/projects/planningDiscovery'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockTransactionDelete = jest.fn()
const mockLegacyDocAdd = jest.fn()
const mockLegacyDocGet = jest.fn()
const mockLegacyDocUpdate = jest.fn()
const mockLegacyDocDelete = jest.fn()

const user = { uid: 'manager-1', role: 'admin' as const, orgId: 'org-1', authKind: 'session' as const }
let accessProject: Record<string, unknown>
let liveProject: Record<string, unknown>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, actor: typeof user, ctx?: unknown) => unknown) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, user, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const brief: PlanningDecisionBrief = {
  outcome: 'Deliver the approved project', user: 'Project managers', whyNow: 'Context must remain current',
  successCriteria: ['Stale docs reopen discovery'], constraints: ['Development only'], outOfScope: ['Production deploy'],
  assumptions: ['Legacy docs remain supported'], risks: ['Stale context'], approvalGates: ['production-deploy'],
}

function readyPlanning(): PlanningDiscoveryState {
  return {
    schemaVersion: 1, revision: 5, status: 'confirmed', mode: 'interview', enforced: true, confidence: 98,
    inspection: {
      brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'], tasks: ['tasks'], tools: ['tools'],
      agents: ['agents'], skills: ['skills'], inspectedBy: 'pip', inspectedAt: '2026-07-27T00:00:00.000Z',
    },
    turns: [{ id: 'q-1', question: 'What is the scope?', currentGuess: 'Safe delivery', askedBy: 'pip', askedAt: '2026-07-27T00:01:00.000Z', answer: 'Approved delivery only', answeredBy: 'peet', answeredAt: '2026-07-27T00:02:00.000Z' }],
    predictedNextAnswers: ['No deploy', 'No send', 'Keep approvals'], intentBlockingUnknowns: [], brief,
    digest: planningDiscoveryDigest(brief), confirmedBy: 'peet', confirmedAt: '2026-07-27T00:03:00.000Z',
  }
}

const projectRef = { path: 'projects/project-1' } as Record<string, unknown>
const legacyDocRef = { path: 'projects/project-1/docs/doc-1', id: 'doc-1' } as Record<string, unknown>
const eventRef = { path: 'projects/project-1/planningDiscoveryEvents/event-1', id: 'event-1' }

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  accessProject = { orgId: 'org-1' }
  liveProject = accessProject
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => accessProject },
    projectAccess: { role: 'manager', canViewInternal: true },
  })
  mockLegacyDocAdd.mockResolvedValue({ id: 'direct-doc' })
  mockLegacyDocGet.mockResolvedValue({ exists: true, id: 'doc-1', data: () => ({ title: 'Requirements', content: 'Original', type: 'requirements' }) })
  mockLegacyDocUpdate.mockResolvedValue(undefined)
  mockLegacyDocDelete.mockResolvedValue(undefined)
  Object.assign(legacyDocRef, { get: mockLegacyDocGet, update: mockLegacyDocUpdate, delete: mockLegacyDocDelete })
  Object.assign(projectRef, {
    collection: jest.fn((name: string) => {
      if (name === 'docs') return {
        doc: jest.fn(() => legacyDocRef),
        add: mockLegacyDocAdd,
        orderBy: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })),
      }
      if (name === 'planningDiscoveryEvents') return { doc: jest.fn(() => eventRef) }
      throw new Error(`Unexpected project subcollection ${name}`)
    }),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: jest.fn(() => projectRef) }
    if (name === 'client_documents') return { where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })), doc: jest.fn() }
    throw new Error(`Unexpected collection ${name}`)
  })
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === projectRef) return { exists: true, data: () => liveProject }
    if (ref === legacyDocRef) return { exists: true, id: 'doc-1', data: () => ({ title: 'Requirements', content: 'Original', type: 'requirements' }) }
    throw new Error('Unexpected transaction read')
  })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
    delete: mockTransactionDelete,
  }))
})

const collectionCtx = { params: Promise.resolve({ projectId: 'project-1' }) }
const itemCtx = { params: Promise.resolve({ projectId: 'project-1', docId: 'doc-1' }) }

function request(method: string, body?: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/docs/doc-1', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('legacy project docs planning enforcement', () => {
  it('initializes enforced discovery transactionally before rejecting a legacy document create', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/docs/route')
    const res = await POST(request('POST', { title: 'Brief', content: 'New intent', type: 'brief' }), collectionCtx)

    expect(res.status).toBe(409)
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionSet).toHaveBeenCalledWith(eventRef, expect.objectContaining({ type: 'started' }))
    expect(mockLegacyDocAdd).not.toHaveBeenCalled()
    expect(mockTransactionSet).not.toHaveBeenCalledWith(legacyDocRef, expect.anything())
  })

  it('initializes enforced discovery transactionally before rejecting a legacy document update', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await PATCH(request('PATCH', { content: 'New intent' }), itemCtx)

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(legacyDocRef, expect.anything())
  })

  it('initializes enforced discovery transactionally before rejecting a legacy document delete', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await DELETE(request('DELETE'), itemCtx)

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionDelete).not.toHaveBeenCalled()
  })

  it('atomically updates a context document and reopens confirmed discovery with an audit snapshot', async () => {
    const current = readyPlanning()
    accessProject = { orgId: 'org-1', planningDiscovery: current }
    liveProject = accessProject
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await PATCH(request('PATCH', { content: 'Materially changed requirements' }), itemCtx)

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(legacyDocRef, expect.objectContaining({ content: 'Materially changed requirements' }))
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({
        status: 'interviewing', revision: current.revision + 1, digest: undefined,
        snapshots: [expect.objectContaining({ revision: current.revision, digest: current.digest })],
      }),
    }))
    expect(mockTransactionSet).toHaveBeenCalledWith(eventRef, expect.objectContaining({ type: 'reopened', previousRevision: current.revision }))
    expect(mockLegacyDocUpdate).not.toHaveBeenCalled()
  })

  it('fails closed before deleting a context document when discovery is stale', async () => {
    accessProject = { orgId: 'org-1', planningDiscovery: { enforced: true, revision: 6, status: 'interviewing' } }
    liveProject = accessProject
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await DELETE(request('DELETE'), itemCtx)

    expect(res.status).toBe(409)
    expect(mockLegacyDocDelete).not.toHaveBeenCalled()
    expect(mockTransactionDelete).not.toHaveBeenCalled()
  })

  it('rejects a read-only external collaborator before creating an unscoped legacy project document', async () => {
    accessProject = { orgId: 'org-1', planningDiscovery: readyPlanning() }
    liveProject = accessProject
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { id: 'project-1', data: () => accessProject },
      projectAccess: {
        role: 'viewer',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: [] },
      },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/docs/route')
    const res = await POST(request('POST', { title: 'External write', content: 'must be denied', type: 'notes' }), collectionCtx)

    expect(res.status).toBe(403)
    expect(mockTransactionSet).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/docs/') }), expect.anything())
  })

  it('rejects a read-only external collaborator before updating a legacy project document', async () => {
    accessProject = { orgId: 'org-1', planningDiscovery: readyPlanning() }
    liveProject = accessProject
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { id: 'project-1', data: () => accessProject },
      projectAccess: {
        role: 'viewer',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: ['doc-1'] },
      },
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await PATCH(request('PATCH', { content: 'must be denied' }), itemCtx)

    expect(res.status).toBe(403)
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(legacyDocRef, expect.anything())
  })

  it('rejects a read-only external collaborator before deleting a legacy project document', async () => {
    accessProject = { orgId: 'org-1', planningDiscovery: readyPlanning() }
    liveProject = accessProject
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { id: 'project-1', data: () => accessProject },
      projectAccess: {
        role: 'viewer',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: ['doc-1'] },
      },
    })

    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await DELETE(request('DELETE'), itemCtx)

    expect(res.status).toBe(403)
    expect(mockTransactionDelete).not.toHaveBeenCalled()
  })

  it('does not return a direct legacy document outside an external grant item allowlist', async () => {
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { id: 'project-1', data: () => accessProject },
      projectAccess: {
        role: 'viewer',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-1', actions: ['project.read'], items: ['other-doc'] },
      },
    })

    const { GET } = await import('@/app/api/v1/projects/[projectId]/docs/[docId]/route')
    const res = await GET(request('GET'), itemCtx)

    expect(res.status).toBe(404)
  })
})
