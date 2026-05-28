jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
  },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { callAsMember, seedOrgMember } from '../../../helpers/crm'

process.env.SESSION_COOKIE_NAME = '__session'

type WebhookDoc = {
  id: string
  data: Record<string, unknown> | null
}

function stageAuth(
  member: ReturnType<typeof seedOrgMember>,
  webhook: WebhookDoc,
  capturedUpdate = jest.fn().mockResolvedValue(undefined),
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId, orgIds: [member.orgId] }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        where: () => ({
          get: () =>
            Promise.resolve({
              docs: [
                {
                  id: `${member.orgId}_${member.uid}`,
                  data: () => member,
                },
              ],
            }),
        }),
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    if (name === 'outbound_webhooks') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: Boolean(webhook.data),
              id: webhook.id,
              data: () => webhook.data,
            }),
          update: capturedUpdate,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
  return capturedUpdate
}

function buildWebhook(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    name: 'CRM to Zapier',
    url: 'https://example.com/pib',
    events: ['contact.created'],
    secret: 'super-secret',
    active: true,
    deleted: false,
    failureCount: 0,
    createdAt: { seconds: 1000 },
    ...overrides,
  }
}

function routeCtx(id = 'wh-1') {
  return { params: Promise.resolve({ id }) }
}

describe('CRM webhook single-resource routes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('GET returns a masked CRM-scoped webhook', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-get', { role: 'admin' })
    stageAuth(admin, { id: 'wh-1', data: buildWebhook() })

    const req = callAsMember(admin, 'GET', '/api/v1/crm/webhooks/wh-1')
    const { GET } = await import('@/app/api/v1/crm/webhooks/[id]/route')
    const res = await GET(req, routeCtx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.webhook.name).toBe('CRM to Zapier')
    expect(body.data.webhook.secret).toBe('***')
  })

  it('PUT validates and updates only the authenticated workspace webhook', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-put', { role: 'admin' })
    const capturedUpdate = stageAuth(admin, { id: 'wh-1', data: buildWebhook() })

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/webhooks/wh-1', {
      name: 'CRM to n8n',
      url: 'https://hooks.example.com/crm',
      events: ['deal.created', 'deal.won'],
      active: false,
    })
    const { PUT } = await import('@/app/api/v1/crm/webhooks/[id]/route')
    const res = await PUT(req, routeCtx())

    expect(res.status).toBe(200)
    expect(capturedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'CRM to n8n',
      url: 'https://hooks.example.com/crm',
      events: ['deal.created', 'deal.won'],
      active: false,
      updatedBy: admin.uid,
    }))
  })

  it('PUT rejects invalid events', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-invalid', { role: 'admin' })
    const capturedUpdate = stageAuth(admin, { id: 'wh-1', data: buildWebhook() })

    const req = callAsMember(admin, 'PUT', '/api/v1/crm/webhooks/wh-1', {
      events: ['contact.created', 'not.real'],
    })
    const { PUT } = await import('@/app/api/v1/crm/webhooks/[id]/route')
    const res = await PUT(req, routeCtx())

    expect(res.status).toBe(400)
    expect(capturedUpdate).not.toHaveBeenCalled()
  })

  it('DELETE soft-deletes the webhook and disables delivery', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-delete', { role: 'admin' })
    const capturedUpdate = stageAuth(admin, { id: 'wh-1', data: buildWebhook() })

    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/webhooks/wh-1')
    const { DELETE } = await import('@/app/api/v1/crm/webhooks/[id]/route')
    const res = await DELETE(req, routeCtx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(capturedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      deleted: true,
      active: false,
      updatedBy: admin.uid,
    }))
  })

  it('POST rotate-secret returns the new secret once', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-rotate', { role: 'admin' })
    const capturedUpdate = stageAuth(admin, { id: 'wh-1', data: buildWebhook() })

    const req = callAsMember(admin, 'POST', '/api/v1/crm/webhooks/wh-1/rotate-secret')
    const { POST } = await import('@/app/api/v1/crm/webhooks/[id]/rotate-secret/route')
    const res = await POST(req, routeCtx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.secret).toBe('***')
    expect(typeof body.data.secretOnce).toBe('string')
    expect(body.data.secretOnce.length).toBeGreaterThan(20)
    expect(capturedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      secret: body.data.secretOnce,
      updatedBy: admin.uid,
    }))
  })

  it('returns 404 for cross-workspace webhooks', async () => {
    const admin = seedOrgMember('org-1', 'uid-hook-cross', { role: 'admin' })
    stageAuth(admin, { id: 'wh-1', data: buildWebhook({ orgId: 'org-2' }) })

    const req = callAsMember(admin, 'GET', '/api/v1/crm/webhooks/wh-1')
    const { GET } = await import('@/app/api/v1/crm/webhooks/[id]/route')
    const res = await GET(req, routeCtx())

    expect(res.status).toBe(404)
  })
})
