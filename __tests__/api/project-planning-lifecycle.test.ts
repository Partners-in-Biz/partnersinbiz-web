import { NextRequest } from 'next/server'
import { planningDiscoveryDigest, type PlanningDecisionBrief, type PlanningDiscoveryState } from '@/lib/projects/planningDiscovery'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectUpdate = jest.fn()
const mockEventDoc = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockTransactionSet = jest.fn()
const mockRunTransaction = jest.fn()

const mockUser = { uid: 'peet', role: 'admin' as const, orgId: 'owner-org', authKind: 'session' as const }
let projectData: Record<string, unknown>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: jest.fn(() => true) }))
jest.mock('@/lib/portal/dashboard-summary', () => ({ touchPortalDashboardSummary: jest.fn(() => Promise.resolve()) }))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const brief: PlanningDecisionBrief = {
  outcome: 'Ship the approved planning gate',
  user: 'Project managers',
  whyNow: 'Unsafe planning mutations are possible',
  successCriteria: ['Planning is fail closed'],
  constraints: ['Development only'],
  outOfScope: ['Production deployment'],
  assumptions: ['Existing execution remains operable'],
  risks: ['Stale project context'],
  approvalGates: ['production-deploy'],
}

function confirmedPlanning(): PlanningDiscoveryState {
  return {
    schemaVersion: 1,
    revision: 5,
    status: 'confirmed',
    mode: 'interview',
    enforced: true,
    confidence: 97,
    inspection: {
      brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['Plan'], tasks: ['tasks'],
      tools: ['tools'], agents: ['agents'], skills: ['skills'], inspectedBy: 'pip', inspectedAt: '2026-07-27T00:00:00.000Z',
    },
    turns: [{
      id: 'q-3', question: 'What matters most?', currentGuess: 'Safety', askedBy: 'pip', askedAt: '2026-07-27T00:01:00.000Z',
      answer: 'Safety without deadlock', answeredBy: 'peet', answeredAt: '2026-07-27T00:02:00.000Z',
    }],
    predictedNextAnswers: ['Development only', 'No deploy', 'Preserve gates'],
    intentBlockingUnknowns: [],
    brief,
    digest: planningDiscoveryDigest(brief),
    confirmedBy: 'peet',
    confirmedAt: '2026-07-27T00:04:00.000Z',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  projectData = {
    id: 'project-1',
    name: 'Planning project',
    description: 'Original description',
    brief: 'Original project brief',
    status: 'discovery',
    orgId: 'owner-org',
    sourceOrgId: 'owner-org',
  }
  mockGetProjectForUser.mockImplementation(async () => ({
    ok: true,
    doc: { id: 'project-1', data: () => projectData },
    projectAccess: { role: 'owner', canViewInternal: true },
  }))
  mockProjectUpdate.mockResolvedValue(undefined)
  mockEventDoc.mockReturnValue({ id: 'event-1' })
  mockProjectDoc.mockReturnValue({
    update: mockProjectUpdate,
    collection: jest.fn(() => ({ doc: mockEventDoc })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
  mockTransactionGet.mockImplementation(async () => ({ exists: true, data: () => projectData }))
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    update: mockTransactionUpdate,
    set: mockTransactionSet,
  }))
})

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/project-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('project planning lifecycle enforcement', () => {
  it('starts enforced discovery but does not apply the first legacy planning-context mutation', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ description: 'New planning intent for this legacy project' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      planningDiscovery: expect.objectContaining({
        enforced: true,
        status: 'interviewing',
        revision: 1,
      }),
    }))
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      description: 'New planning intent for this legacy project',
    }))
    expect(mockTransactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'started',
      revision: 1,
    }))
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['name', { name: 'Renamed legacy project' }],
    ['target date', { targetDate: '2026-08-15' }],
  ])('starts enforced discovery without applying a legacy %s mutation', async (_label, patch) => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest(patch), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(409)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      planningDiscovery: expect.objectContaining({ enforced: true, status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining(patch))
  })

  it('fails closed when a legacy project is promoted beyond discovery without planning readiness', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ status: 'design' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(409)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('allows lifecycle promotion only when the exact planning state is ready', async () => {
    projectData.planningDiscovery = confirmedPlanning()
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ status: 'design' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'design' }))
  })

  it('fails closed when planning becomes stale before an otherwise-ready target-date commit', async () => {
    const confirmed = confirmedPlanning()
    projectData.planningDiscovery = confirmed
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...projectData, planningDiscovery: { ...confirmed, status: 'interviewing' } }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ targetDate: '2026-08-15' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(409)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('atomically reopens confirmed planning and preserves its audit snapshot after a material description change', async () => {
    const confirmed = confirmedPlanning()
    projectData.planningDiscovery = confirmed
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ description: 'Materially different delivery intent' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      description: 'Materially different delivery intent',
      planningDiscovery: expect.objectContaining({
        status: 'interviewing',
        revision: confirmed.revision + 1,
        brief: undefined,
        digest: undefined,
        snapshots: [expect.objectContaining({
          revision: confirmed.revision,
          digest: confirmed.digest,
          brief,
          staleReason: 'Project description materially changed',
        })],
      }),
    }))
    expect(mockTransactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'reopened',
      previousRevision: confirmed.revision,
      previousDigest: confirmed.digest,
      previousBrief: brief,
    }))
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
  })

  it('fails closed when planning changes concurrently with a material project-context update', async () => {
    const confirmed = confirmedPlanning()
    projectData.planningDiscovery = confirmed
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...projectData, planningDiscovery: { ...confirmed, revision: confirmed.revision + 1 } }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({ description: 'Concurrent context update' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
    expect(mockTransactionSet).not.toHaveBeenCalled()
  })

  it('does not promote lifecycle in the same mutation that makes a confirmed brief stale', async () => {
    projectData.planningDiscovery = confirmedPlanning()
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const res = await PATCH(patchRequest({
      description: 'Materially different delivery intent',
      status: 'design',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(409)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })
})
