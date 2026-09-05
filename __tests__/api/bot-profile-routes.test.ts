import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }
const agentDocs: Record<string, Record<string, unknown>> = {}
const appearanceDocs: Record<string, Record<string, unknown>> = {}
const memberDocs: Record<string, Record<string, unknown>> = {}
const mockAgentSet = jest.fn()
const mockAppearanceSet = jest.fn()
const mockCallAgentPath = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'agent_team') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: Boolean(agentDocs[id]), data: () => agentDocs[id] }),
            set: async (patch: Record<string, unknown>) => {
              mockAgentSet(id, patch)
              agentDocs[id] = { ...agentDocs[id], ...patch }
            },
          }),
        }
      }
      if (name === 'orgMembers') {
        return { doc: (id: string) => ({ get: async () => ({ exists: Boolean(memberDocs[id]), data: () => memberDocs[id] }) }) }
      }
      if (name === 'bot_appearance') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: Boolean(appearanceDocs[id]), data: () => appearanceDocs[id] }),
            set: async (doc: Record<string, unknown>) => {
              mockAppearanceSet(id, doc)
              appearanceDocs[id] = { ...appearanceDocs[id], ...doc }
            },
          }),
          where: () => ({ get: async () => ({ docs: Object.values(appearanceDocs).map((data) => ({ data: () => data })) }) }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
  getAdminApp: jest.fn(),
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))
jest.mock('@/lib/agents/team', () => ({
  callAgentPath: (...args: unknown[]) => mockCallAgentPath(...args),
}))

const ctx = (agentId: string) => ({ params: Promise.resolve({ orgId: 'org-1', agentId }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'member-1', role: 'client', orgId: 'org-1' }
  for (const store of [agentDocs, appearanceDocs, memberDocs]) {
    for (const key of Object.keys(store)) delete store[key]
  }
  agentDocs.theo = { agentId: 'theo', name: 'Theo', enabled: true, apiKey: 'enc' }
  agentDocs['oa-1-research'] = {
    agentId: 'oa-1-research',
    name: 'Research',
    enabled: true,
    apiKey: 'enc',
    scopeOrgId: 'org-1',
    accessScope: 'organization',
    provisioningMode: 'linked_device',
    ownerUserId: 'owner-1',
  }
  agentDocs['oa-2-other'] = { agentId: 'oa-2-other', name: 'Other', enabled: true, apiKey: 'enc', scopeOrgId: 'org-2' }
  memberDocs['org-1_member-1'] = { role: 'member' }
  memberDocs['org-1_admin-1'] = { role: 'admin' }
})

describe('bot appearance route', () => {
  it('saves a built-in style per org and reports it back through visible-agents', async () => {
    const { PATCH } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/appearance/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/orgs/org-1/bots/theo/appearance', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ avatarStyle: 'geometric' }),
    }), ctx('theo'))
    expect(res.status).toBe(200)
    expect(mockAppearanceSet).toHaveBeenCalledWith('org-1_theo', expect.objectContaining({
      orgId: 'org-1',
      agentId: 'theo',
      avatarStyle: 'geometric',
      avatarUrl: null,
      updatedByUserId: 'member-1',
    }))
    expect(mockAgentSet).not.toHaveBeenCalled()

    const { loadBotAppearanceMapForOrg } = await import('@/lib/agents/bot-appearance')
    await expect(loadBotAppearanceMapForOrg('org-1')).resolves.toEqual({ theo: { avatarUrl: null, avatarStyle: 'geometric' } })
  })

  it('refuses the image style without an upload and rejects unknown styles', async () => {
    const { PATCH } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/appearance/route')
    let res = await PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ avatarStyle: 'image' }) }), ctx('theo'))
    expect(res.status).toBe(400)
    res = await PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ avatarStyle: 'sparkles' }) }), ctx('theo'))
    expect(res.status).toBe(400)
    expect(mockAppearanceSet).not.toHaveBeenCalled()
  })

  it('hides bots that belong to another organisation', async () => {
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/appearance/route')
    const res = await GET(new NextRequest('http://localhost/x'), ctx('oa-2-other'))
    expect(res.status).toBe(404)
  })
})

describe('bot avatar upload route', () => {
  it('rejects unsupported types and oversized files before touching storage', async () => {
    const { POST } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/avatar/route')
    const video = new FormData()
    video.append('file', new File(['x'], 'clip.webm', { type: 'video/webm' }))
    let res = await POST(new NextRequest('http://localhost/x', { method: 'POST', body: video }), ctx('theo'))
    expect(res.status).toBe(400)

    const big = new FormData()
    big.append('file', new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    res = await POST(new NextRequest('http://localhost/x', { method: 'POST', body: big }), ctx('theo'))
    expect(res.status).toBe(413)
    expect(mockAppearanceSet).not.toHaveBeenCalled()
  })
})

describe('bot mailbox route', () => {
  it('shows the stored address to any org member without provisioning rights', async () => {
    agentDocs.theo.mailbox = { provider: 'hermes-mail-agent', address: 'theo@bots.example.test', inboxId: 'inb_1', status: 'active', updatedAt: 'now' }
    const { GET } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/mailbox/route')
    const res = await GET(new NextRequest('http://localhost/x'), ctx('theo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ agentId: 'theo', mailbox: { address: 'theo@bots.example.test' }, canProvisionMailbox: false })
  })

  it('blocks members from provisioning a platform specialist mailbox', async () => {
    const { POST } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/mailbox/route')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx('theo'))
    expect(res.status).toBe(403)
    expect(mockCallAgentPath).not.toHaveBeenCalled()
  })

  it('returns the [NEED] note and stores nothing when the Hermes Mail Agent is missing', async () => {
    mockUser = { uid: 'admin-1', role: 'client', orgId: 'org-1' }
    mockCallAgentPath.mockResolvedValue({ response: new Response('not found', { status: 404 }), data: { raw: 'not found' } })
    const { POST } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/mailbox/route')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx('oa-1-research'))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('[NEED] Hermes Mail Agent')
    expect(mockCallAgentPath).toHaveBeenCalledWith('oa-1-research', '/api/mail/inbox', expect.objectContaining({ method: 'POST' }))
    expect(mockAgentSet).not.toHaveBeenCalled()
    expect(agentDocs['oa-1-research'].mailbox).toBeUndefined()
  })

  it('stores only the address the Hermes Mail Agent returned', async () => {
    mockUser = { uid: 'admin-1', role: 'client', orgId: 'org-1' }
    mockCallAgentPath.mockResolvedValue({
      response: new Response('{}', { status: 201 }),
      data: { address: 'Research@Bots.Example.Test', inboxId: 'inb_42', secret: 'never-stored' },
    })
    const { POST } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/mailbox/route')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx('oa-1-research'))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.mailbox).toMatchObject({ provider: 'hermes-mail-agent', address: 'research@bots.example.test', inboxId: 'inb_42', status: 'active' })
    expect(mockAgentSet).toHaveBeenCalledWith('oa-1-research', expect.objectContaining({
      mailbox: expect.not.objectContaining({ secret: expect.anything() }),
    }))
  })

  it('rejects a Hermes response that carries no real address', async () => {
    mockUser = { uid: 'admin-1', role: 'client', orgId: 'org-1' }
    mockCallAgentPath.mockResolvedValue({ response: new Response('{}', { status: 200 }), data: { ok: true } })
    const { POST } = await import('@/app/api/v1/orgs/[orgId]/bots/[agentId]/mailbox/route')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx('oa-1-research'))
    expect(res.status).toBe(502)
    expect(mockAgentSet).not.toHaveBeenCalled()
  })
})
