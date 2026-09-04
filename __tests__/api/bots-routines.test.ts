/**
 * @jest-environment node
 */
import { GET } from '@/app/api/v1/bots/[botId]/routines/route'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: unknown) => handler,
}))

jest.mock('@/lib/api/orgScope', () => ({
  resolveOrgScope: () => ({ ok: true, orgId: 'org-1' }),
}))

jest.mock('@/lib/llm-providers/org-guard', () => ({
  clientCanAccessOrg: () => true,
}))

jest.mock('@/lib/agents/team', () => ({
  callAgentPath: jest.fn(async () => ({
    response: { ok: true, status: 200 },
    data: {
      jobs: [
        { id: 'cron-1', name: '[bot:blake] Daily invoice', schedule: '0 9 * * *', enabled: true },
      ],
    },
  })),
}))

const mockGet = jest.fn()
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: mockGet,
          }),
        }),
      }),
    }),
  },
}))

describe('GET /api/v1/bots/[botId]/routines', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'conv-1',
          data: () => ({
            goalState: { goal: 'Ship leftover uploads', status: 'active' },
          }),
        },
      ],
    })
  })

  it('merges cron jobs and standing goals for a bot', async () => {
    const req = {
      nextUrl: new URL('http://localhost/api/v1/bots/blake/routines?orgId=org-1'),
    } as any
    const res = await GET(req, { uid: 'u1', role: 'client' } as any, {
      params: Promise.resolve({ botId: 'blake' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    const routines = body.data?.routines ?? body.routines
    expect(routines).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cron-1', source: 'cron', name: expect.stringContaining('invoice') }),
      expect.objectContaining({ id: 'goal:conv-1', source: 'goal', name: 'Ship leftover uploads' }),
    ]))
  })

  it('rejects invalid bot ids', async () => {
    const req = {
      nextUrl: new URL('http://localhost/api/v1/bots/!!!/routines?orgId=org-1'),
    } as any
    const res = await GET(req, { uid: 'u1', role: 'client' } as any, {
      params: Promise.resolve({ botId: '!!!' }),
    })
    expect(res.status).toBe(400)
  })
})
