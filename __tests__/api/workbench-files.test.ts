import { NextRequest } from 'next/server'
import type { WorkbenchJob } from '@/lib/messages/workbench/jobs'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetConversation = jest.fn()
const mockResolveWorkbenchSyncTree = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
}))

jest.mock('@/lib/messages/workbench/resolve-sync', () => ({
  resolveWorkbenchSyncTree: mockResolveWorkbenchSyncTree,
}))

function baseConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['client-1'],
    participantAgentIds: ['pip'],
    ...overrides,
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
  mockGetConversation.mockResolvedValue(baseConversation())
  mockResolveWorkbenchSyncTree.mockResolvedValue({ source: 'none', tree: [] })
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('GET /api/v1/conversations/[convId]/workbench/files', () => {
  it('404s when the conversation is missing', async () => {
    mockGetConversation.mockResolvedValue(null)
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/files'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(404)
  })

  it('403s for a non-participant', async () => {
    mockUser = { uid: 'stranger', role: 'client', orgId: 'org-1' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/files'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(403)
    expect(mockResolveWorkbenchSyncTree).not.toHaveBeenCalled()
  })

  it('returns source none with an empty tree when there is no sync data', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/files'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.source).toBe('none')
    expect(body.data.tree).toEqual([])
    expect(body.data.runtime.hasMapping).toBe(false)
  })

  it('returns the resolved sync tree when a manifest is available', async () => {
    mockResolveWorkbenchSyncTree.mockResolvedValue({
      source: 'sync',
      tree: [{ name: 'index.ts', path: 'index.ts', kind: 'file' }],
      revision: 'rev-1',
      requestId: 'req-1',
      replicaId: 'replica-1',
      entryCount: 1,
    })
    mockGetConversation.mockResolvedValue(baseConversation({
      workspaceContext: { mappingId: 'mapping-1', mappingLabel: 'MacBook', runtimeTarget: 'local', runtimeLabel: 'Local', folderScope: 'project', projectName: 'Acme' },
    }))

    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/files/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/files'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.source).toBe('sync')
    expect(body.data.tree).toEqual([{ name: 'index.ts', path: 'index.ts', kind: 'file' }])
    expect(body.data.revision).toBe('rev-1')
    expect(body.data.runtime).toEqual(expect.objectContaining({
      hasMapping: true,
      mappingLabel: 'MacBook',
      projectName: 'Acme',
      folderScope: 'project',
    }))
  })
})

describe('GET /api/v1/conversations/[convId]/workbench/changes', () => {
  it('reports the jobs-backed contract for Phase 2b without blocking on a device', async () => {
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/changes/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/changes'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.source).toBe('jobs')
    expect(body.data.changes).toEqual([])
    expect(body.data.message).toMatch(/refresh/i)
  })

  it('403s for a non-participant', async () => {
    mockUser = { uid: 'stranger', role: 'client', orgId: 'org-1' }
    const { GET } = await import('@/app/api/v1/conversations/[convId]/workbench/changes/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/changes'),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/conversations/[convId]/workbench/terminal', () => {
  it('rejects commands that are not allowlisted', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/workbench/terminal/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/terminal', {
        method: 'POST',
        body: JSON.stringify({ command: 'rm -rf /' }),
      }),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.code).toBe('WORKBENCH_SHELL_COMMAND_NOT_ALLOWED')
  })

  it('403s for a non-participant before validating the command', async () => {
    mockUser = { uid: 'stranger', role: 'client', orgId: 'org-1' }
    const { POST } = await import('@/app/api/v1/conversations/[convId]/workbench/terminal/route')

    const res = await POST(
      new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/terminal', {
        method: 'POST',
        body: JSON.stringify({ command: 'git status' }),
      }),
      { params: Promise.resolve({ convId: 'conv-1' }) },
    )

    expect(res.status).toBe(403)
  })

  it('answers pwd directly from the authorized relative folder without a device job', async () => {
    const { handleWorkbenchTerminalCommand } = await import('@/app/api/v1/conversations/[convId]/workbench/terminal/route')
    const authorize = jest.fn(async () => ({ relativeFolder: 'projects/project-a' } as never))
    const enqueue = jest.fn()

    const request = new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/terminal', {
      method: 'POST',
      body: JSON.stringify({ command: 'pwd' }),
    })
    const response = await handleWorkbenchTerminalCommand(request, { uid: 'client-1', role: 'client', orgId: 'org-1' } as never, 'conv-1', { authorize, enqueue })

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body.data).toEqual({ cwd: 'projects/project-a' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('enqueues the mapped operation for an allowlisted command and returns 202', async () => {
    const { handleWorkbenchTerminalCommand } = await import('@/app/api/v1/conversations/[convId]/workbench/terminal/route')
    const authorization = {
      conversation: { id: 'conv-1', orgId: 'org-1' },
      projectId: null,
      relativeFolder: '.',
      binding: {
        deviceId: 'device-a', runtimeTargetId: 'runtime-a', credentialVersion: 3,
        workspaceId: 'workspace-a', mappingId: 'mapping-a',
      },
    }
    const authorize = jest.fn(async () => authorization as never)
    const enqueue = jest.fn(async (input: Record<string, unknown>) => ({
      jobId: 'job-1', kind: input.kind, status: 'queued', attempt: 0,
      createdAtMs: 1_000, updatedAtMs: 1_000, expiresAtMs: 100_000,
      encryptedOperation: null, encryptedResult: null,
    } as unknown as WorkbenchJob))

    const request = new NextRequest('http://localhost/api/v1/conversations/conv-1/workbench/terminal', {
      method: 'POST',
      body: JSON.stringify({ command: 'git status' }),
    })
    const response = await handleWorkbenchTerminalCommand(request, { uid: 'client-1', role: 'client', orgId: 'org-1' } as never, 'conv-1', { authorize, enqueue })

    expect(response.status).toBe(202)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'git.status', operation: { kind: 'git.status' } }))
    const body = await readJson(response)
    expect(body.data).toMatchObject({ jobId: 'job-1', kind: 'git.status', status: 'queued' })
  })
})
