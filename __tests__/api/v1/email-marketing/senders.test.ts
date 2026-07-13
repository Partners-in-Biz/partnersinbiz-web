import { NextRequest } from 'next/server'

const mockUser = { uid: 'user-1', role: 'client', orgId: 'org-1' }
const listSenderIdentities = jest.fn()
const createSenderIdentity = jest.fn()
const getSenderIdentity = jest.fn()
const updateSenderIdentity = jest.fn()
const deleteSenderIdentity = jest.fn()
const listSenderPolicies = jest.fn()
const createSenderPolicy = jest.fn()
const updateSenderPolicy = jest.fn()
const resolveSenderForRecipient = jest.fn()
const normalizeSenderPolicy = jest.fn((input: Record<string, unknown>) => ({
  id: typeof input.id === 'string' ? input.id : 'preview',
  orgId: 'org-1',
  name: 'Preview policy',
  strategy: input.strategy,
  purpose: input.purpose,
  defaultIdentityId: null,
  fixedIdentityId: null,
  fallbackIdentityId: null,
  roundRobinIdentityIds: [],
  noOwnerBehavior: 'exclude',
  allowConnectedMailbox: false,
  connectedMailboxMaxRecipients: 1,
  enabled: true,
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: Function) => (req: NextRequest, user: typeof mockUser, context?: unknown) => handler(req, user, 'org-1', context),
}))

jest.mock('@/lib/email-marketing/sender-store', () => ({
  listSenderIdentities: (...args: unknown[]) => listSenderIdentities(...args),
  createSenderIdentity: (...args: unknown[]) => createSenderIdentity(...args),
  getSenderIdentity: (...args: unknown[]) => getSenderIdentity(...args),
  updateSenderIdentity: (...args: unknown[]) => updateSenderIdentity(...args),
  deleteSenderIdentity: (...args: unknown[]) => deleteSenderIdentity(...args),
  listSenderPolicies: (...args: unknown[]) => listSenderPolicies(...args),
  createSenderPolicy: (...args: unknown[]) => createSenderPolicy(...args),
  updateSenderPolicy: (...args: unknown[]) => updateSenderPolicy(...args),
  normalizeSenderPolicy: (...args: unknown[]) => normalizeSenderPolicy(...args),
}))

jest.mock('@/lib/email-marketing/sender-resolution', () => ({
  resolveSenderForRecipient: (...args: unknown[]) => resolveSenderForRecipient(...args),
}))

import * as identitiesRoute from '@/app/api/v1/email-marketing/sender-identities/route'
import * as identityRoute from '@/app/api/v1/email-marketing/sender-identities/[id]/route'
import * as policiesRoute from '@/app/api/v1/email-marketing/sender-policies/route'
import * as previewRoute from '@/app/api/v1/email-marketing/sender-policies/preview/route'

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sender identity API', () => {
  it('lists only the authenticated tenant identities', async () => {
    listSenderIdentities.mockResolvedValue([{ id: 'sender-1', orgId: 'org-1' }])
    const response = await identitiesRoute.GET(request('/api/v1/email-marketing/sender-identities?orgId=org-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listSenderIdentities).toHaveBeenCalledWith('org-1')
    expect(body.data.identities).toHaveLength(1)
  })

  it('creates an identity with server-owned org and actor fields', async () => {
    createSenderIdentity.mockResolvedValue({ id: 'sender-1', orgId: 'org-1' })
    const response = await identitiesRoute.POST(request('/api/v1/email-marketing/sender-identities?orgId=org-1', 'POST', {
      orgId: 'org-other',
      displayName: 'Alex',
      emailAddress: 'alex@example.test',
      mode: 'esp_domain',
      domainId: 'domain-1',
      purposes: ['marketing_bulk'],
    }))

    expect(response.status).toBe(201)
    expect(createSenderIdentity).toHaveBeenCalledWith('org-1', expect.objectContaining({ displayName: 'Alex' }), 'user-1')
  })

  it('returns 404 instead of exposing another tenant identity', async () => {
    getSenderIdentity.mockResolvedValue(null)
    const response = await identityRoute.GET(
      request('/api/v1/email-marketing/sender-identities/sender-other?orgId=org-1'),
      { params: Promise.resolve({ id: 'sender-other' }) },
    )
    expect(response.status).toBe(404)
  })

  it('updates and soft-deletes by tenant-scoped id', async () => {
    updateSenderIdentity.mockResolvedValue({ id: 'sender-1', enabled: false })
    deleteSenderIdentity.mockResolvedValue(true)

    const patch = await identityRoute.PATCH(
      request('/api/v1/email-marketing/sender-identities/sender-1?orgId=org-1', 'PATCH', { enabled: false }),
      { params: Promise.resolve({ id: 'sender-1' }) },
    )
    const remove = await identityRoute.DELETE(
      request('/api/v1/email-marketing/sender-identities/sender-1?orgId=org-1', 'DELETE'),
      { params: Promise.resolve({ id: 'sender-1' }) },
    )

    expect(patch.status).toBe(200)
    expect(remove.status).toBe(200)
    expect(updateSenderIdentity).toHaveBeenCalledWith('org-1', 'sender-1', { enabled: false }, 'user-1')
    expect(deleteSenderIdentity).toHaveBeenCalledWith('org-1', 'sender-1', 'user-1')
  })
})

describe('sender policy API and preview', () => {
  it('lists and creates policies in the authenticated tenant', async () => {
    listSenderPolicies.mockResolvedValue([])
    createSenderPolicy.mockResolvedValue({ id: 'policy-1', orgId: 'org-1' })

    const get = await policiesRoute.GET(request('/api/v1/email-marketing/sender-policies?orgId=org-1'))
    const post = await policiesRoute.POST(request('/api/v1/email-marketing/sender-policies?orgId=org-1', 'POST', {
      name: 'Sales-owned', strategy: 'contact_owner', purpose: 'marketing_bulk', noOwnerBehavior: 'fallback', fallbackIdentityId: 'fallback-1',
    }))

    expect(get.status).toBe(200)
    expect(post.status).toBe(201)
    expect(createSenderPolicy).toHaveBeenCalledWith('org-1', expect.objectContaining({ strategy: 'contact_owner' }), 'user-1')
  })

  it('previews deterministic resolution counts and reasons without writing or sending', async () => {
    resolveSenderForRecipient
      .mockResolvedValueOnce({ status: 'resolved', identity: { id: 'sales-1', ownerUid: 'u1' }, reason: null })
      .mockResolvedValueOnce({ status: 'resolved', identity: { id: 'fallback', ownerUid: null }, reason: null, fallbackReason: 'no_contact_owner' })
      .mockResolvedValueOnce({ status: 'excluded', identity: null, reason: 'no_contact_owner' })

    const response = await previewRoute.POST(request('/api/v1/email-marketing/sender-policies/preview?orgId=org-1', 'POST', {
      policy: { id: 'preview', strategy: 'contact_owner', purpose: 'marketing_bulk' },
      recipients: [
        { contactId: 'c1', contactOwnerUid: 'u1' },
        { contactId: 'c2' },
        { contactId: 'c3' },
      ],
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      total: 3,
      resolved: 2,
      excluded: 1,
      blocked: 0,
      byIdentity: { 'sales-1': 1, fallback: 1 },
      byReason: { no_contact_owner: 1 },
      fallbackReasons: { no_contact_owner: 1 },
    })
    expect(resolveSenderForRecipient).toHaveBeenCalledTimes(3)
    expect(createSenderIdentity).not.toHaveBeenCalled()
    expect(createSenderPolicy).not.toHaveBeenCalled()
    expect(updateSenderPolicy).not.toHaveBeenCalled()
  })
})
