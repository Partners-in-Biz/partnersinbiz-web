/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const MOCK_USER: ApiUser = {
  uid: 'admin-1',
  orgId: 'org-1',
  orgIds: ['org-1'],
  role: 'client',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, MOCK_USER, ctx),
}))

const clientCanAccessOrg = jest.fn(() => true)
jest.mock('@/lib/llm-providers/org-guard', () => ({
  clientCanAccessOrg: (...args: unknown[]) => clientCanAccessOrg(...args as []),
}))

const orgFeatureFlagEnabled = jest.fn(async () => true)
jest.mock('@/lib/organizations/feature-flags', () => ({
  orgFeatureFlagEnabled: (...args: unknown[]) => orgFeatureFlagEnabled(...args as []),
}))

const assertCanManageTeams = jest.fn(async () => undefined)
const assertCanEditTeamMembers = jest.fn(async () => undefined)
jest.mock('@/lib/org-teams/service', () => ({
  assertCanManageTeams: (...args: unknown[]) => assertCanManageTeams(...args as []),
  assertCanEditTeamMembers: (...args: unknown[]) => assertCanEditTeamMembers(...args as []),
  archiveOrgTeamWithCascade: jest.fn(async () => ({
    team: { teamId: 'org-1_growth', status: 'archived', memberUserIds: ['user-a'] },
    revokedGrantIds: [],
    revokedBindingIds: [],
  })),
}))

const listOrgTeams = jest.fn(async () => [{ teamId: 'org-1_growth', name: 'Growth' }])
const createOrgTeam = jest.fn(async (input: { slug: string }) => ({ teamId: `org-1_${input.slug}`, slug: input.slug }))
const getOrgTeam = jest.fn(async () => ({
  teamId: 'org-1_growth', orgId: 'org-1', slug: 'growth', name: 'Growth',
  memberUserIds: ['user-a'], leadUserIds: ['user-a'], status: 'active',
}))
const updateOrgTeam = jest.fn(async () => ({ teamId: 'org-1_growth', name: 'Growth 2' }))
const setOrgTeamMembers = jest.fn(async () => ({ teamId: 'org-1_growth', memberUserIds: ['user-b'] }))
jest.mock('@/lib/org-teams/store', () => ({
  listOrgTeams: (...args: unknown[]) => listOrgTeams(...args as []),
  createOrgTeam: (...args: unknown[]) => createOrgTeam(...args as []),
  getOrgTeam: (...args: unknown[]) => getOrgTeam(...args as []),
  updateOrgTeam: (...args: unknown[]) => updateOrgTeam(...args as []),
  setOrgTeamMembers: (...args: unknown[]) => setOrgTeamMembers(...args as []),
}))

import { GET, POST } from '@/app/api/v1/orgs/[orgId]/teams/route'
import { PATCH, DELETE } from '@/app/api/v1/orgs/[orgId]/teams/[teamId]/route'
import { PUT } from '@/app/api/v1/orgs/[orgId]/teams/[teamId]/members/route'

function request(url: string, init?: RequestInit) {
  return new NextRequest(url, init)
}

const ctx = { params: Promise.resolve({ orgId: 'org-1', teamId: 'org-1_growth' }) }

describe('org team routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clientCanAccessOrg.mockReturnValue(true)
    orgFeatureFlagEnabled.mockResolvedValue(true)
    MOCK_USER.uid = 'admin-1'
  })

  it('lists teams for an org member when the flag is on', async () => {
    const res = await GET(request('http://localhost/api/v1/orgs/org-1/teams'), ctx)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { teams: [{ teamId: 'org-1_growth' }] } })
  })

  it('returns 404 when the feature flag is off', async () => {
    orgFeatureFlagEnabled.mockResolvedValue(false)
    const res = await GET(request('http://localhost/api/v1/orgs/org-1/teams'), ctx)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'feature_disabled' })
  })

  it('returns 403 for a user outside the org', async () => {
    clientCanAccessOrg.mockReturnValue(false)
    const res = await POST(request('http://localhost/api/v1/orgs/org-1/teams', {
      method: 'POST',
      body: JSON.stringify({ slug: 'growth', name: 'Growth' }),
    }), ctx)
    expect(res.status).toBe(403)
  })

  it('creates a team for an admin', async () => {
    const res = await POST(request('http://localhost/api/v1/orgs/org-1/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'growth', name: 'Growth', memberUserIds: ['user-a'] }),
    }), ctx)
    expect(res.status).toBe(201)
    expect(createOrgTeam).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', slug: 'growth', actorUserId: 'admin-1', memberUserIds: ['user-a'],
    }))
  })

  it('forbids a plain member from creating a team', async () => {
    assertCanManageTeams.mockRejectedValueOnce(new Error('org teams: administrator required'))
    await expect(POST(request('http://localhost/api/v1/orgs/org-1/teams', {
      method: 'POST',
      body: JSON.stringify({ slug: 'growth', name: 'Growth' }),
    }), ctx)).rejects.toThrow('administrator required')
  })

  it('lets a lead update members of their own team', async () => {
    const res = await PUT(request('http://localhost/api/v1/orgs/org-1/teams/org-1_growth/members', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberUserIds: ['user-b'], leadUserIds: ['user-b'] }),
    }), ctx)
    expect(res.status).toBe(200)
    expect(assertCanEditTeamMembers).toHaveBeenCalled()
    expect(setOrgTeamMembers).toHaveBeenCalled()
  })

  it('archives a team', async () => {
    const res = await DELETE(request('http://localhost/api/v1/orgs/org-1/teams/org-1_growth', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(200)
  })

  it('renames a team', async () => {
    const res = await PATCH(request('http://localhost/api/v1/orgs/org-1/teams/org-1_growth', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Growth 2' }),
    }), ctx)
    expect(res.status).toBe(200)
    expect(updateOrgTeam).toHaveBeenCalledWith(expect.objectContaining({ name: 'Growth 2' }))
  })
})
