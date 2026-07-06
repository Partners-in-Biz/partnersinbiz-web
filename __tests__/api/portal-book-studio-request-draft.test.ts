import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<Response> | Response

const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTransaction: (fn: (tx: any) => Promise<void>) => mockRunTransaction(fn),
  },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: NextRequest, ...args: any[]) =>
      handler(req, 'uid-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'member', ...args),
}))

type DocRecord = { id: string; data: Record<string, unknown> }

type MockRef = { id: string; __collection: string; get: () => Promise<unknown> }

/**
 * Stages a fake Firestore for organizations + book_studio_projects + tasks +
 * book_studio_draft_requests (dedupe locks) + book_studio_decision_logs.
 * `tasksInStore` seeds a live tasks store that the dedupe transaction query
 * reads and `tx.create` appends to, so concurrent-request races can be
 * exercised. Like real Firestore server transactions (which take pessimistic
 * locks on the dedupe doc read), `runTransaction` calls execute strictly one
 * after another. `addSpy` records every write across every collection.
 */
function stageFirestore(options: {
  settings: Record<string, unknown>
  project?: Record<string, unknown> | null
  tasksInStore?: DocRecord[]
}) {
  const { settings, project = null, tasksInStore = [] } = options
  const addSpy = jest.fn().mockResolvedValue({ id: 'new-id' })
  const tasksStore: DocRecord[] = [...tasksInStore]
  const lockStore = new Map<string, Record<string, unknown>>()
  let taskDocCount = 0

  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings }) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return { doc: () => ({ get: mockOrgGet }) }
    }
    if (name === 'book_studio_projects') {
      return {
        doc: (id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: Boolean(project) && id === (project as Record<string, unknown>)?.__id,
            data: () => project ?? {},
          }),
        }),
      }
    }
    if (name === 'tasks') {
      return {
        where: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            get: () =>
              Promise.resolve({
                docs: tasksStore.map((d) => ({ id: d.id, data: () => d.data })),
              }),
          }),
        }),
        doc: (): MockRef => {
          taskDocCount += 1
          const id = `task-${taskDocCount}`
          return {
            id,
            __collection: name,
            get: () => Promise.resolve({ exists: false, data: () => undefined }),
          }
        },
      }
    }
    if (name === 'book_studio_draft_requests') {
      return {
        doc: (id: string): MockRef => ({
          id,
          __collection: name,
          get: () =>
            Promise.resolve({ exists: lockStore.has(id), data: () => lockStore.get(id) }),
        }),
      }
    }
    // book_studio_decision_logs and any other collection
    return {
      add: (data: Record<string, unknown>) => {
        addSpy(name, data)
        return Promise.resolve({ id: 'new-id' })
      },
    }
  })

  // Serialize transactions the way Firestore's pessimistic doc locks do: a
  // second transaction touching the same lock doc waits for the first to
  // commit before its reads run.
  let txChain: Promise<unknown> = Promise.resolve()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockRunTransaction.mockImplementation((fn: (tx: any) => Promise<void>) => {
    const tx = {
      get: (refOrQuery: { get: () => Promise<unknown> }) => refOrQuery.get(),
      set: (ref: MockRef, data: Record<string, unknown>) => {
        lockStore.set(ref.id, data)
        addSpy(ref.__collection, data)
      },
      create: (ref: MockRef, data: Record<string, unknown>) => {
        tasksStore.push({ id: ref.id, data })
        addSpy(ref.__collection, data)
      },
    }
    const run = txChain.then(() => fn(tx))
    txChain = run.catch(() => undefined)
    return run
  })

  return { addSpy }
}

const ENABLED_EDIT_SETTINGS = {
  portalModules: { bookStudio: true },
  modulePolicies: {
    bookStudio: {
      actions: {
        edit: { owner: true, admin: true, member: true },
      },
    },
  },
}

const project = { __id: 'proj-1', orgId: 'org-1', title: 'My Book', deleted: false }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1/request-draft', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/portal/book-studio/projects/[id]/request-draft', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('201s and creates a task + decision log', async () => {
    const { addSpy } = stageFirestore({ settings: ENABLED_EDIT_SETTINGS, project })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    const res = await POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.taskId).toBeDefined()
    expect(body.data.requestKey).toBe('book-draft:proj-1:cover:project')

    const taskCall = addSpy.mock.calls.find((call) => call[0] === 'tasks')
    expect(taskCall).toBeDefined()
    const taskDoc = taskCall![1] as Record<string, unknown>
    expect(taskDoc).toMatchObject({
      orgId: 'org-1',
      status: 'todo',
      requestKey: 'book-draft:proj-1:cover:project',
      tags: expect.arrayContaining(['book-studio', 'ai-draft-request']),
    })

    const decisionLogCall = addSpy.mock.calls.find((call) => call[0] === 'book_studio_decision_logs')
    expect(decisionLogCall).toBeDefined()
    const decisionLogDoc = decisionLogCall![1] as Record<string, unknown>
    expect(decisionLogDoc).toMatchObject({
      orgId: 'org-1',
      projectId: 'proj-1',
    })
    expect(decisionLogDoc.safeSummary).toContain('cover')
  })

  it('409s when an open request already exists for the same unit', async () => {
    stageFirestore({
      settings: ENABLED_EDIT_SETTINGS,
      project,
      tasksInStore: [
        {
          id: 'task-existing',
          data: { orgId: 'org-1', requestKey: 'book-draft:proj-1:cover:project', status: 'todo', deleted: false },
        },
      ],
    })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    const res = await POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.success).toBe(false)
  })

  it('creates exactly one task when two identical requests race', async () => {
    const { addSpy } = stageFirestore({ settings: ENABLED_EDIT_SETTINGS, project })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    // Fire both requests before either resolves — with the old read-then-add
    // dedupe both passed the check and both created a task; the transaction
    // serializes them so the second sees the first's task and 409s.
    const [res1, res2] = await Promise.all([
      POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) }),
      POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) }),
    ])

    expect([res1.status, res2.status].sort()).toEqual([201, 409])

    const taskCalls = addSpy.mock.calls.filter((call) => call[0] === 'tasks')
    expect(taskCalls).toHaveLength(1)
    const decisionLogCalls = addSpy.mock.calls.filter((call) => call[0] === 'book_studio_decision_logs')
    expect(decisionLogCalls).toHaveLength(1)
  })

  it('404s when the project belongs to another org', async () => {
    stageFirestore({
      settings: ENABLED_EDIT_SETTINGS,
      project: { __id: 'proj-1', orgId: 'org-2', title: 'Not mine' },
    })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    const res = await POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Book project not found')
  })

  it('400s on invalid unitType', async () => {
    stageFirestore({ settings: ENABLED_EDIT_SETTINGS, project })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    const res = await POST(makeRequest({ unitType: 'not-a-real-unit' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('403s when canEdit toggle is off for the role', async () => {
    stageFirestore({
      settings: {
        portalModules: { bookStudio: true },
        modulePolicies: {
          bookStudio: {
            actions: {
              edit: { owner: true, admin: true, member: false },
            },
          },
        },
      },
      project,
    })

    const { POST } = await import(
      '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'
    )
    const res = await POST(makeRequest({ unitType: 'cover' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })
})
