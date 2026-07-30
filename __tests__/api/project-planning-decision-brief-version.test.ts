import { NextRequest } from 'next/server'
import type { PlanningDecisionBrief, PlanningDiscoveryState } from '@/lib/projects/planningDiscovery'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockTransactionSet = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockDecisionBriefDoc = jest.fn()

const user = { uid: 'agent:pip', role: 'ai' as const, orgId: 'owner-org', authKind: 'agent_api_key' as const, agentId: 'pip' }
const projectRef = { path: 'projects/project-1' } as Record<string, unknown>
const decisionBriefRef = { path: 'projects/project-1/decisionBriefs/versioned' }
const eventRef = { path: 'projects/project-1/planningDiscoveryEvents/event-1', id: 'event-1' }

const brief: PlanningDecisionBrief = {
  outcome: 'Ship mandatory interactive planning',
  user: 'Project managers and delivery agents',
  whyNow: 'Planning must be current before execution begins',
  successCriteria: ['Every plan is confirmed or explicitly assumption-attested'],
  constraints: ['Development only'],
  outOfScope: ['Production promotion'],
  assumptions: ['Existing protected approval gates remain active'],
  risks: ['Stale context could release the wrong work'],
  approvalGates: ['production-deploy'],
}

const current: PlanningDiscoveryState = {
  schemaVersion: 1,
  revision: 2,
  status: 'interviewing',
  mode: 'interview',
  enforced: true,
  inspection: {
    brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'], tasks: ['tasks'],
    tools: ['tools'], agents: ['agents'], skills: ['skills'], inspectedBy: 'agent:pip', inspectedAt: '2026-07-27T00:00:00.000Z',
  },
  turns: [],
  snapshots: [],
}

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

beforeEach(() => {
  jest.clearAllMocks()
  Object.assign(projectRef, {
    collection: jest.fn((name: string) => {
      if (name === 'decisionBriefs') return { doc: mockDecisionBriefDoc }
      if (name === 'planningDiscoveryEvents') return { doc: jest.fn(() => eventRef) }
      throw new Error(`Unexpected project subcollection ${name}`)
    }),
  })
  mockDecisionBriefDoc.mockReturnValue(decisionBriefRef)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: jest.fn(() => projectRef) }
    throw new Error(`Unexpected collection ${name}`)
  })
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => ({ orgId: 'owner-org', planningDiscovery: current }) },
    projectAccess: { role: 'owner' },
  })
  mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'owner-org', planningDiscovery: current }) })
  mockRunTransaction.mockImplementation(async (work: (tx: unknown) => unknown) => work({
    get: mockTransactionGet,
    update: mockTransactionUpdate,
    set: mockTransactionSet,
  }))
})

test('stores each surfaced Decision Brief as an immutable revisioned record', async () => {
  const { POST } = await import('@/app/api/v1/projects/[projectId]/planning-discovery/route')
  const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/planning-discovery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'owner-org' },
    body: JSON.stringify({ type: 'surface_brief', expectedRevision: 2, brief }),
  }), { params: Promise.resolve({ projectId: 'project-1' }) })

  expect(response.status).toBe(200)
  expect(mockDecisionBriefDoc).toHaveBeenCalledWith(expect.stringMatching(/^3-[a-f0-9]{64}$/))
  expect(mockTransactionSet).toHaveBeenCalledWith(decisionBriefRef, expect.objectContaining({
    version: 3,
    revision: 3,
    brief,
  }))
})
