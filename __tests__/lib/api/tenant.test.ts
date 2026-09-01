import { NextRequest, NextResponse } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockCollection = jest.fn()
const mockUserGet = jest.fn()
const mockOrgMembersWhere = jest.fn()
const mockOrgMembersGet = jest.fn()
const mockStaffCanServe = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('@/lib/auth/staff-client-org', () => ({
  pibStaffCanServeClientOrg: (...args: unknown[]) => mockStaffCanServe(...args),
}))

describe('withTenant client org resolution', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', orgId: 'default-org', activeOrgId: 'default-org', orgIds: ['default-org'] }),
    })
    mockOrgMembersWhere.mockReturnValue({ get: mockOrgMembersGet })
    mockOrgMembersGet.mockResolvedValue({
      docs: [
        { id: 'lumen-org_client-1', data: () => ({ orgId: 'lumen-org', uid: 'client-1' }) },
      ],
    })
    mockStaffCanServe.mockResolvedValue(false)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: mockUserGet }) }
      if (name === 'orgMembers') {
        return {
          where: mockOrgMembersWhere,
          doc: (id: string) => ({
            get: async () => ({
              exists: id === 'lumen-org_client-1',
              data: () => (id === 'lumen-org_client-1'
                ? { orgId: 'lumen-org', uid: 'client-1', status: 'active', role: 'member' }
                : undefined),
            }),
          }),
        }
      }
      if (name === 'organizations') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }) }
      throw new Error(`Unexpected collection ${name}`)
    })
  })

  it('honours an accessible portal orgId query param instead of the active fallback org', async () => {
    const { withTenant } = await import('@/lib/api/tenant')
    const handler = jest.fn(async (_req, _user, orgId) => NextResponse.json({ orgId }))
    const wrapped = withTenant(handler)

    const res = await wrapped(
      new NextRequest('http://localhost/api/v1/social/posts?orgId=lumen-org'),
      { uid: 'client-1', role: 'client' } as ApiUser,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orgId).toBe('lumen-org')
    expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({ uid: 'client-1' }), 'lumen-org', undefined)
  })

  it('rejects a portal orgId query param that the client cannot access', async () => {
    mockOrgMembersGet.mockResolvedValue({ docs: [] })
    const { withTenant } = await import('@/lib/api/tenant')
    const handler = jest.fn(async (_req, _user, orgId) => NextResponse.json({ orgId }))
    const wrapped = withTenant(handler)

    const res = await wrapped(
      new NextRequest('http://localhost/api/v1/social/posts?orgId=other-org'),
      { uid: 'client-1', role: 'client' } as ApiUser,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('X-Org-Id header is required for AI agent requests')
    expect(handler).not.toHaveBeenCalled()
  })

  it('honours a dual-scope token orgId even without portal membership', async () => {
    mockOrgMembersGet.mockResolvedValue({ docs: [] })
    const { withTenant } = await import('@/lib/api/tenant')
    const handler = jest.fn(async (_req, _user, orgId) => NextResponse.json({ orgId }))
    const wrapped = withTenant(handler)

    const res = await wrapped(
      new NextRequest('http://localhost/api/v1/social/posts?orgId=wS5pgwa6c9WbPocf4w0w'),
      {
        uid: 'stean',
        role: 'client',
        orgId: 'pib-platform-owner',
        orgIds: ['pib-platform-owner', 'wS5pgwa6c9WbPocf4w0w'],
      } as ApiUser,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orgId).toBe('wS5pgwa6c9WbPocf4w0w')
    expect(handler).toHaveBeenCalled()
  })

  it('allows PiB staff to request a served client org without membership', async () => {
    mockOrgMembersGet.mockResolvedValue({ docs: [] })
    mockStaffCanServe.mockResolvedValue(true)
    const { withTenant } = await import('@/lib/api/tenant')
    const handler = jest.fn(async (_req, _user, orgId) => NextResponse.json({ orgId }))
    const wrapped = withTenant(handler)

    const res = await wrapped(
      new NextRequest('http://localhost/api/v1/social/posts?orgId=wS5pgwa6c9WbPocf4w0w'),
      {
        uid: 'stean',
        role: 'client',
        orgId: 'pib-platform-owner',
        orgIds: ['pib-platform-owner'],
      } as ApiUser,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orgId).toBe('wS5pgwa6c9WbPocf4w0w')
  })
})
