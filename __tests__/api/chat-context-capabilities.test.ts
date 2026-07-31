import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser) => Promise<Response>

let mockUser: MockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (req: NextRequest) => handler(req, mockUser),
}))

describe('chat context capabilities API', () => {
  beforeEach(() => {
    jest.resetModules()
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
  })

  it('returns exhaustive live-read coverage for the selected organisation', async () => {
    const { GET } = await import('@/app/api/v1/chat-context/capabilities/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/chat-context/capabilities?orgId=org-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      orgId: 'org-1',
      coverage: {
        totalKinds: 25,
        liveReadKinds: 25,
        specializedKinds: 18,
        sealedRuntimeKinds: 1,
        inlineActionKinds: 18,
        navigateActionKinds: 7,
      },
    })
    expect(body.data.capabilities).toHaveLength(25)
    expect(body.data.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'project',
        authoritativeSource: 'Projects and Kanban',
        adapterLevel: 'specialized',
        actionLevel: 'inline',
      }),
      expect.objectContaining({
        kind: 'workspace_folder',
        authoritativeSource: 'Authorised linked computer',
        adapterLevel: 'sealed_runtime',
      }),
    ]))
  })

  it('rejects a client-selected organisation outside their scope', async () => {
    const { GET } = await import('@/app/api/v1/chat-context/capabilities/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/chat-context/capabilities?orgId=org-other'))

    expect(response.status).toBe(403)
  })
})
