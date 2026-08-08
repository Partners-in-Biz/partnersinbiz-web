import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; activeOrgId?: string; allowedOrgIds?: string[]; agentId?: string }
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
import { POST as createSession } from '@/app/api/v1/design-iteration/sessions/route'
import { POST as addVariants } from '@/app/api/v1/design-iteration/sessions/[sessionId]/variants/route'
import { POST as decide } from '@/app/api/v1/design-iteration/sessions/[sessionId]/variants/[variantId]/decision/route'
import { POST as applyRoute } from '@/app/api/v1/design-iteration/sessions/[sessionId]/apply/route'

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org-1', ...headers },
    body: JSON.stringify(body),
  })
}

const STORED_VARIANTS = [
  { id: 'v_1', archetype: 'Bolder hero', description: 'x', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
  { id: 'v_2', archetype: 'Sharp corners', description: 'y', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
]

function storedSession(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1', url: 'https://example.com', instruction: 'make the hero bolder',
    elementRefs: [], variants: STORED_VARIANTS, status: 'review',
    createdAtMs: 1000, updatedAtMs: 1000,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform', activeOrgId: 'org-1' }
  mockDoc.mockReturnValue({ id: 'di_1', get: mockGet, set: mockSet, update: mockUpdate })
  mockCollection.mockReturnValue({ doc: mockDoc, where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs: [] }) }) }) }) })
  mockGet.mockResolvedValue({ exists: false })
  ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
  ;(messagesCollection as jest.Mock).mockReturnValue({ doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }), update: mockUpdate }) })
})

describe('POST /api/v1/design-iteration/sessions', () => {
  it('creates a session with variants and returns the card presentation', async () => {
    const res = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', {
      url: 'https://example.com',
      instruction: 'make the hero bolder',
      elementRefs: [{ ref: '@e12', name: 'Hero' }],
      screenshotUrl: 'https://cdn.example/baseline.jpg',
      variants: [
        { archetype: 'Bolder hero', description: 'Larger display scale.', changeType: 'dom-css' },
        { archetype: 'Sharp corners', description: 'Zero-radius.', changeType: 'dom-css' },
      ],
    }), mockUser)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.session.id).toMatch(/^di_/)
    expect(body.data.presentation.richParts[0].type).toBe('design_iteration')
    expect(body.data.presentation.uiActions.length).toBe(5) // 2 accept + 2 reject + open_context
  })

  it('rejects missing instruction and bad URLs', async () => {
    const noInstruction = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', { url: 'https://example.com' }), mockUser)
    expect(noInstruction.status).toBe(400)
    const badUrl = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', { url: 'javascript:alert(1)', instruction: 'x' }), mockUser)
    expect(badUrl.status).toBe(400)
    const credsUrl = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', { url: 'https://user:pass@example.com', instruction: 'x' }), mockUser)
    expect(credsUrl.status).toBe(400)
  })

  it('rejects a body.orgId the caller cannot access (403, cross-tenant)', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', activeOrgId: 'org-1', orgIds: ['org-1'] }
    const res = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', {
      url: 'https://example.com', instruction: 'x', orgId: 'org-2',
    }), mockUser)
    expect(res.status).toBe(403)
  })

  it('records the actor label when X-Agent-Actor is present', async () => {
    mockUser = { uid: 'agent:theo', role: 'ai', agentId: 'theo' }
    const res = await createSession(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions', {
      url: 'https://example.com', instruction: 'x', orgId: 'org-1', variants: [{ archetype: 'Bolder hero', description: 'x', changeType: 'dom-css' }],
    }, { 'x-agent-actor': 'theo' }), mockUser)
    expect(res.status).toBe(201)
    const body = await res.json() as { data: { session: { createdBy: string } } }
    expect(body.data.session.createdBy).toBe('agent:theo')
  })
})

describe('POST /api/v1/design-iteration/sessions/[id]/variants', () => {
  it('appends variants to an existing deck', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession() })
    const res = await addVariants(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/variants', {
      variants: [{ archetype: 'Quiet minimal', description: 'Reduce noise.', changeType: 'dom-css' }],
    }), { params: Promise.resolve({ sessionId: 'di_1' }) } as never)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.session.variants).toHaveLength(3)
  })

  it('requires a non-empty variants array', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession() })
    const res = await addVariants(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/variants', { variants: [] }), { params: Promise.resolve({ sessionId: 'di_1' }) } as never)
    expect(res.status).toBe(400)
  })
})

describe('POST .../variants/[variantId]/decision', () => {
  it('accepts a variant', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession() })
    const res = await decide(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/variants/v_1/decision', { decision: 'accept' }), {
      params: Promise.resolve({ sessionId: 'di_1', variantId: 'v_1' }),
    } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.variant.status).toBe('accepted')
    expect(body.data.session.status).toBe('accepted')
  })

  it('rejects invalid decisions', async () => {
    const res = await decide(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/variants/v_1/decision', { decision: 'maybe' }), {
      params: Promise.resolve({ sessionId: 'di_1', variantId: 'v_1' }),
    } as never)
    expect(res.status).toBe(400)
  })
})

describe('POST .../apply', () => {
  it('records an apply only when a variant is accepted', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession({ acceptedVariantId: 'v_1', status: 'accepted' }) })
    const res = await applyRoute(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/apply', {
      repo: 'partnersinbiz-web-development',
      branch: 'development',
      filesChanged: ['app/page.tsx'],
      diffSummary: '+12 -3 hero block',
      detectorExitCode: 0,
      detectorFindings: 0,
    }), { params: Promise.resolve({ sessionId: 'di_1' }) } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.session.status).toBe('applied')
    expect(body.data.session.apply.repo).toBe('partnersinbiz-web-development')
  })

  it('refuses apply without an accepted variant (409)', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession() })
    const res = await applyRoute(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/apply', {
      repo: 'partnersinbiz-web-development', branch: 'development', filesChanged: ['x'], diffSummary: 'y',
    }), { params: Promise.resolve({ sessionId: 'di_1' }) } as never)
    expect(res.status).toBe(409)
  })

  it('refuses a production branch on apply (400, development-only contract)', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'di_1', data: () => storedSession({ acceptedVariantId: 'v_1', status: 'accepted' }) })
    const res = await applyRoute(jsonRequest('https://partnersinbiz.online/api/v1/design-iteration/sessions/di_1/apply', {
      repo: 'partnersinbiz-web-development', branch: 'main', filesChanged: ['app/page.tsx'], diffSummary: 'hero change',
    }), { params: Promise.resolve({ sessionId: 'di_1' }) } as never)
    expect(res.status).toBe(400)
  })
})
