import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; activeOrgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockGet = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform', activeOrgId: 'org-1' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: 'admin' | 'client', handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => {
    const roleOk =
      mockUser.role === 'ai' ||
      mockUser.role === 'admin' ||
      (requiredRole === 'client' && mockUser.role === 'client')
    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    return handler(req, mockUser, ctx)
  },
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

jest.mock('@/lib/messages/openContextHandoff', () => ({
  parseMessagesHandoffIds: jest.fn(() => ({ conversationId: null, responseMessageId: null })),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import { POST as createRun } from '@/app/api/v1/design-audit/runs/route'

function jsonRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://partnersinbiz.online/api/v1/design-audit/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org-1', ...headers },
    body: JSON.stringify(body),
  })
}

function fetchResponse(html: string, status = 200, contentType = 'text/html'): Response {
  return new Response(html, { status, headers: { 'content-type': contentType } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform', activeOrgId: 'org-1' }
  mockDoc.mockReturnValue({ id: 'dar_1', get: mockGet, set: mockSet, update: mockUpdate })
  mockCollection.mockReturnValue({ doc: mockDoc })
  mockGet.mockResolvedValue({ exists: false })
  ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
  ;(messagesCollection as jest.Mock).mockReturnValue({
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'assistant', uiActions: [], richParts: [], contextRefs: [] }) }), update: mockUpdate }),
  })
  global.fetch = jest.fn(async () => fetchResponse('<!doctype html><html lang="en"><body><h1>Title</h1><p>Body</p></body></html>')) as unknown as typeof fetch
})

describe('POST /api/v1/design-audit/runs', () => {
  it('creates an audit run and returns the card presentation', async () => {
    const res = await createRun(jsonRequest({ url: 'https://example.com/' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(201)
    const body = await res.json() as { success: boolean; data: { run: { orgId: string; url: string }; presentation: { richParts: Array<{ type: string }>; uiActions: unknown[]; contextRef: { type: string } } } }
    expect(body.success).toBe(true)
    expect(body.data.run.orgId).toBe('org-1')
    expect(body.data.run.url).toBe('https://example.com/')
    expect(body.data.presentation.richParts[0].type).toBe('design_audit')
    expect(body.data.presentation.contextRef.type).toBe('design')
    expect(body.data.presentation.uiActions.length).toBe(4)
  })

  it('rejects private-network URLs with a tenant-safe guard', async () => {
    const res = await createRun(jsonRequest({ url: 'http://localhost:3000/' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Private-network')
  })

  it('rejects non-http schemes', async () => {
    const res = await createRun(jsonRequest({ url: 'file:///etc/passwd' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
  })

  it('honors allowPrivateNetwork when explicitly requested', async () => {
    const res = await createRun(jsonRequest({ url: 'http://localhost:3000/', allowPrivateNetwork: true }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(201)
  })

  it('rejects allowPrivateNetwork self-grant by an agent actor (403)', async () => {
    const res = await createRun(jsonRequest(
      { url: 'http://localhost:3000/', allowPrivateNetwork: true },
      { 'x-agent-actor': 'theo' },
    ), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Only the human')
  })

  it('rejects a body.orgId the caller cannot access (403, cross-tenant)', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', activeOrgId: 'org-1', orgIds: ['org-1'] }
    const res = await createRun(jsonRequest({ url: 'https://example.com/', orgId: 'org-2' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(403)
  })

  it('rejects non-http screenshotUrl', async () => {
    const res = await createRun(jsonRequest({ url: 'https://example.com/', screenshotUrl: 'javascript:alert(1)' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
  })

  it('passes through scope narrowing', async () => {
    const res = await createRun(jsonRequest({ url: 'https://example.com/', scope: 'type' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(201)
    const body = await res.json() as { data: { run: { scope: string } } }
    expect(body.data.run.scope).toBe('type')
  })

  it('surfaces fetch failures as 502', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    const res = await createRun(jsonRequest({ url: 'https://example.com/' }), mockUser as never, { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(502)
  })
})
