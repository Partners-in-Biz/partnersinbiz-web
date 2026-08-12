jest.mock('@/lib/api/public-rate-limit', () => ({
  enforcePublicRateLimit: jest.fn().mockResolvedValue(null),
  publicRateLimitHash: (value: string) => value,
  publicRequestIp: () => '127.0.0.1',
}))

jest.mock('@/lib/api/response', () => ({
  apiError: (error: string, status: number, data?: Record<string, unknown>) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ success: false, error, ...data }, { status })
  },
  apiSuccess: (data: unknown) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ success: true, data })
  },
  apiErrorFromException: (error: Error) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  },
}))

const get = jest.fn()
const doc = jest.fn(() => ({ get }))
const collection = jest.fn(() => ({ doc }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection } }))

jest.mock('@/lib/orgMembers/memberRef', () => ({
  buildHumanRef: (uid: string, data: Record<string, unknown>) => ({
    uid,
    displayName: data?.displayName ?? uid,
    kind: 'human',
  }),
}))

const sessionUser = jest.fn()
const authorizeAccept = jest.fn()
jest.mock('@/lib/partner-links/identity', () => ({
  activeMembershipsForUid: jest.fn(),
  attachUserToOrg: jest.fn(),
  authorizeAccept: (...args: unknown[]) => authorizeAccept(...args),
  cleanString: (value: unknown) => typeof value === 'string' ? value.trim() : '',
  resolveInviteUser: jest.fn(),
  sessionUser: (...args: unknown[]) => sessionUser(...args),
  slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
  uniqueOrgIdForName: jest.fn(),
}))

const acceptPartnerInvite = jest.fn()
const getPartnerInviteByToken = jest.fn()
jest.mock('@/lib/partner-links/store', () => ({
  acceptPartnerInvite: (...args: unknown[]) => acceptPartnerInvite(...args),
  declinePartnerInvite: jest.fn(),
  getPartnerInviteByToken: (...args: unknown[]) => getPartnerInviteByToken(...args),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/public/partner-invites/[token]/route'

const invite = {
  id: 'invite-1',
  kind: 'contact' as const,
  sourceOrgId: 'org-a',
  sourceCompanyId: 'company-a',
  sourceContactId: 'contact-gary',
  recipientEmail: 'gary@gamma.example',
  recipientName: 'Gary Driver',
  recipientCompanyName: 'Gamma Logistics',
  proposedCapabilities: ['crm'],
  proposedFieldSharingPolicy: {},
  inviteToken: 'a'.repeat(48),
  status: 'pending' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/v1/public/partner-invites/${invite.inviteToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept', ...body }),
  })
}

describe('POST public partner invite acceptance — approver identity separation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getPartnerInviteByToken.mockResolvedValue(invite)
    get.mockResolvedValue({ exists: true, data: () => ({ displayName: 'Gamma Owner' }) })
    acceptPartnerInvite.mockResolvedValue({
      partnerLinkId: 'link-1',
      targetOrgId: 'org-c',
      recipientIdentityMatched: false,
      identityLinkIds: ['identity-1'],
    })
  })

  it('records the owner/admin approver separately and never passes them as targetUserId', async () => {
    sessionUser.mockResolvedValue({ uid: 'user:gamma-owner', email: 'owner@gamma.example' })
    authorizeAccept.mockResolvedValue({
      ok: true,
      reason: 'org_admin',
      candidateOrgIds: ['org-c'],
    })

    const res = await POST(request({ orgId: 'org-c' }), { params: Promise.resolve({ token: invite.inviteToken }) })
    expect(res.status).toBe(200)
    expect(acceptPartnerInvite).toHaveBeenCalledWith(expect.objectContaining({
      targetOrgId: 'org-c',
      targetUserId: undefined,
      approvedByUserId: 'user:gamma-owner',
      recipientIdentityMatched: false,
      actor: { uid: 'user:gamma-owner', displayName: 'Gamma Owner', kind: 'human' },
    }))
    const payload = await res.json()
    expect(payload.data.uid).toBe('user:gamma-owner')
    expect(payload.data.recipientLinked).toBe(false)
  })

  it('uses the recipient uid as both recipient identity and approver only when the email identity matched', async () => {
    sessionUser.mockResolvedValue({ uid: 'user:gary', email: 'gary@gamma.example' })
    authorizeAccept.mockResolvedValue({
      ok: true,
      reason: 'recipient',
      candidateOrgIds: ['org-c'],
    })

    const res = await POST(request({ orgId: 'org-c' }), { params: Promise.resolve({ token: invite.inviteToken }) })
    expect(res.status).toBe(200)
    expect(acceptPartnerInvite).toHaveBeenCalledWith(expect.objectContaining({
      targetOrgId: 'org-c',
      targetUserId: 'user:gary',
      approvedByUserId: 'user:gary',
      recipientIdentityMatched: true,
    }))
    const payload = await res.json()
    expect(payload.data.recipientLinked).toBe(true)
  })
})
