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

const canAccessConversation = jest.fn(() => true)
jest.mock('@/lib/conversations/access', () => ({
  canAccessConversation: (...args: unknown[]) => canAccessConversation(...args),
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

jest.mock('@/lib/routines/service', () => ({
  listRoutinesForAgent: jest.fn(async () => ([
    {
      routineId: 'rt_abc',
      orgId: 'org-1',
      agentId: 'blake',
      ownerUserId: 'u1',
      accessScope: 'personal',
      name: 'PiB morning brief',
      prompt: 'Brief me',
      trigger: { kind: 'schedule', cron: '0 8 * * *', tz: 'UTC' },
      triggerKind: 'schedule',
      conversationId: null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: Date.parse('2026-09-05T08:00:00.000Z'),
      runCount: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
      status: 'active',
    },
  ])),
  assertBotRoutinesEnabled: jest.fn(),
  assertCanCreateRoutine: jest.fn(),
  createRoutine: jest.fn(),
  RoutineAuthError: class RoutineAuthError extends Error { status = 403 },
  RoutineFlagDisabledError: class RoutineFlagDisabledError extends Error {},
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
    canAccessConversation.mockReturnValue(true)
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'conv-1',
          data: () => ({
            orgId: 'org-1',
            participantUids: ['u1'],
            goalState: { goal: 'Ship leftover uploads', status: 'active' },
          }),
        },
        {
          id: 'conv-private',
          data: () => ({
            orgId: 'org-1',
            participantUids: ['other'],
            workspaceContext: { shareMode: 'private' },
            goalState: { goal: 'Secret private goal', status: 'active' },
          }),
        },
      ],
    })
  })

  it('merges cron jobs, standing goals, and PiB routines for a bot', async () => {
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
      expect.objectContaining({ id: 'rt_abc', source: 'routine', name: 'PiB morning brief' }),
    ]))
  })

  it('omits standing goals from conversations the caller cannot access', async () => {
    canAccessConversation.mockImplementation((_user, conversation: { id?: string }) => conversation.id !== 'conv-private')
    const req = {
      nextUrl: new URL('http://localhost/api/v1/bots/blake/routines?orgId=org-1'),
    } as any
    const res = await GET(req, { uid: 'u1', role: 'client', orgId: 'org-1' } as any, {
      params: Promise.resolve({ botId: 'blake' }),
    })
    const body = await res.json()
    const routines = body.data?.routines ?? body.routines
    expect(routines).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'goal:conv-1' }),
    ]))
    expect(routines.find((row: { id: string }) => row.id === 'goal:conv-private')).toBeUndefined()
    expect(routines.find((row: { name?: string }) => row.name === 'Secret private goal')).toBeUndefined()
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
