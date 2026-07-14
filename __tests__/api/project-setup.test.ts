import { NextRequest } from 'next/server'

let mockUser: { uid: string; role: 'admin' | 'client'; orgId?: string; orgIds?: string[] } = {
  uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) => handler(req, mockUser),
}))

beforeEach(() => {
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner' }
})

describe('project setup API', () => {
  it('returns an actionable 202 plan and does not claim setup completion', async () => {
    const { POST } = await import('@/app/api/v1/projects/setup/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'standard', orgId: 'pib-platform-owner', projectName: 'New campaign',
        workspaceId: 'partners', locationIds: ['partners-vps'],
      }),
    }))
    const body = await response.json()
    expect(response.status).toBe(202)
    expect(body.data.plan).toEqual(expect.objectContaining({
      state: 'awaiting_standard_provisioning', completed: false, syncCompleted: false,
    }))
  })

  it('denies setup in an organisation the caller cannot access', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'client-org', orgIds: ['client-org'] }
    const { POST } = await import('@/app/api/v1/projects/setup/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'standard', orgId: 'other-org', projectName: 'Nope', workspaceId: 'other' }),
    }))
    expect(response.status).toBe(403)
  })

  it('returns a validation error instead of pretending full-client provisioning started', async () => {
    const { POST } = await import('@/app/api/v1/projects/setup/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'full_client', clientName: 'Acme', domainSlug: '../acme', projectName: 'Launch' }),
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('domainSlug must be kebab-case')
  })
})
