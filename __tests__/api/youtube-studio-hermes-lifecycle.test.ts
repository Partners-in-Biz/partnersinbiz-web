import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' }

type MockAuthHandler = (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockAuthHandler) => (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

type FirestoreDoc = {
  id: string
  data: Record<string, unknown>
  set?: jest.Mock
}

type CollectionFixture = {
  listDocs?: FirestoreDoc[]
  docs?: Record<string, FirestoreDoc>
  add?: jest.Mock
}

function stageFirestore(fixtures: Record<string, CollectionFixture>) {
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName === 'organizations') {
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true }) }) }
    }
    const fixture = fixtures[collectionName]
    if (!fixture) throw new Error(`Unexpected collection ${collectionName}`)
    return {
      where: (...args: unknown[]) => {
        mockWhere(...args)
        return { get: async () => ({ docs: (fixture.listDocs ?? []).map((doc) => ({ id: doc.id, data: () => doc.data })) }) }
      },
      add: fixture.add ?? mockAdd,
      doc: (id?: string) => {
        const docId = id ?? 'new-doc-id'
        mockDoc(docId)
        const record = fixture.docs?.[docId]
        const set = record?.set ?? mockDocSet
        const ref = { id: docId, set }
        return {
          id: docId,
          set,
          get: async () => {
            mockDocGet(docId)
            if (!record) return { exists: false, id: docId, data: () => undefined, ref }
            return { exists: true, id: record.id, data: () => record.data, ref }
          },
        }
      },
    }
  })
  mockAdd.mockResolvedValue({ id: 'artifact-1' })
  mockDocSet.mockResolvedValue(undefined)
}

function jobFixture(overrides: Record<string, unknown> = {}): FirestoreDoc {
  return {
    id: 'job-1',
    data: {
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      skillKey: 'youtube-publish-readiness',
      title: 'Publish readiness',
      status: 'queued',
      priority: 'normal',
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      inputPacket: {
        skillKey: 'youtube-publish-readiness',
        skillLabel: 'Publish readiness',
        family: 'readiness',
        requiredContext: ['publishing packet'],
        outputArtifacts: ['readiness result'],
        guardrails: ['No autonomous public publishing.'],
        policySourceKeys: ['youtube_data_api_upload_private_first'],
        references: {
          channelWorkspaceId: 'channel-1',
          videoProjectId: 'video-1',
          sourceAssetIds: [],
          clipCandidateIds: [],
          productionDraftIds: [],
          renderJobIds: [],
          publishingPacketIds: ['packet-1'],
          analyticsSnapshotIds: [],
        },
      },
      linked: { publishingPacketIds: ['packet-1'] },
      deleted: false,
      ...overrides,
    },
    set: jest.fn().mockResolvedValue(undefined),
  }
}

describe('YouTube Studio Hermes execution lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' }
    process.env.YOUTUBE_STUDIO_HERMES_WORKER_URL = 'https://hermes-worker.test/v1/runs'
    process.env.YOUTUBE_STUDIO_HERMES_WORKER_KEY = 'worker-key'
    global.fetch = jest.fn()
  })

  afterEach(() => {
    delete process.env.YOUTUBE_STUDIO_HERMES_WORKER_URL
    delete process.env.YOUTUBE_STUDIO_HERMES_WORKER_KEY
  })

  it('dispatches a queued packet job to Hermes and persists run, heartbeat, status history, and an audit comment', async () => {
    const job = jobFixture()
    const commentAdd = jest.fn().mockResolvedValue({ id: 'comment-1' })
    stageFirestore({
      youtube_agent_jobs: { docs: { 'job-1': job } },
      comments: { add: commentAdd },
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ runId: 'run-1', status: 'running' }),
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/agent-jobs/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/agent-jobs', {
      method: 'PUT',
      body: JSON.stringify({ orgId: 'org-1', jobId: 'job-1', action: 'dispatch' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.runId).toBe('run-1')
    expect(global.fetch).toHaveBeenCalledWith('https://hermes-worker.test/v1/runs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer worker-key' }),
      body: expect.stringContaining('[YouTube Studio job job-1]'),
    }))
    expect(job.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      hermesRunId: 'run-1',
      agentConversationId: 'run-1',
      agentHeartbeatAt: 'SERVER_TS',
      lifecycleState: 'dispatched',
      updatedBy: 'admin-1',
    }), { merge: true })
    expect(commentAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      resourceType: 'youtube_agent_job',
      resourceId: 'job-1',
      body: expect.stringContaining('Hermes run dispatched'),
    }))
  })

  it('records heartbeats and completion callbacks as reviewable output without mutating linked publishing packet state', async () => {
    const job = jobFixture({ status: 'running', hermesRunId: 'run-1' })
    const packetSet = jest.fn()
    const artifactAdd = jest.fn().mockResolvedValue({ id: 'artifact-1' })
    stageFirestore({
      youtube_agent_jobs: { docs: { 'job-1': job } },
      youtube_agent_job_artifacts: { add: artifactAdd },
      youtube_publishing_packets: { docs: { 'packet-1': { id: 'packet-1', data: { orgId: 'org-1', status: 'client_review', deleted: false }, set: packetSet } } },
      comments: {},
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/agent-jobs/route')
    const heartbeat = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/agent-jobs', {
      method: 'PUT',
      body: JSON.stringify({ orgId: 'org-1', jobId: 'job-1', action: 'callback', runId: 'run-1', status: 'running', heartbeat: true }),
    }))
    expect(heartbeat.status).toBe(200)
    expect(job.set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'running',
      agentHeartbeatAt: 'SERVER_TS',
      lifecycleState: 'heartbeat',
    }), { merge: true })

    const completed = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/agent-jobs', {
      method: 'PUT',
      body: JSON.stringify({
        orgId: 'org-1',
        jobId: 'job-1',
        action: 'callback',
        runId: 'run-1',
        status: 'completed',
        output: {
          summary: 'Ready for human review.',
          artifacts: [{ type: 'readiness_result', label: 'Readiness report', content: 'All checks prepared.' }],
          publishState: { status: 'scheduled', visibility: 'public' },
        },
      }),
    }))
    const body = await completed.json()

    expect(completed.status).toBe(200)
    expect(body.data.status).toBe('waiting_for_review')
    expect(artifactAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      jobId: 'job-1',
      reviewState: 'pending',
      type: 'readiness_result',
      content: 'All checks prepared.',
    }))
    expect(job.set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'waiting_for_review',
      outputArtifactIds: ['artifact-1'],
      reviewableOutput: expect.objectContaining({
        summary: 'Ready for human review.',
        publishStateMutationBlocked: true,
      }),
      lifecycleState: 'awaiting_review',
    }), { merge: true })
    expect(packetSet).not.toHaveBeenCalled()
  })

  it('supports cancellation and retry without duplicating old run state', async () => {
    const job = jobFixture({ status: 'running', hermesRunId: 'run-1', retryCount: 1 })
    stageFirestore({
      youtube_agent_jobs: { docs: { 'job-1': job } },
      comments: {},
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' })
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => JSON.stringify({ id: 'run-2' }) })

    const { PUT } = await import('@/app/api/v1/youtube-studio/agent-jobs/route')
    const cancel = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/agent-jobs', {
      method: 'PUT',
      body: JSON.stringify({ orgId: 'org-1', jobId: 'job-1', action: 'cancel', reason: 'Client changed direction' }),
    }))
    expect(cancel.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith('https://hermes-worker.test/v1/runs/run-1/stop', expect.objectContaining({ method: 'POST' }))
    expect(job.set).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled', blockedReason: 'Client changed direction' }), { merge: true })

    const retry = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/agent-jobs', {
      method: 'PUT',
      body: JSON.stringify({ orgId: 'org-1', jobId: 'job-1', action: 'retry' }),
    }))
    const body = await retry.json()
    expect(retry.status).toBe(200)
    expect(body.data.runId).toBe('run-2')
    expect(job.set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'running',
      hermesRunId: 'run-2',
      retryCount: 2,
      outputArtifactIds: [],
      reviewableOutput: null,
      blockedReason: null,
    }), { merge: true })
  })
})
