// __tests__/api/v1/crm/ai/compose-email.test.ts
// 6 tests for the AI email composer endpoint

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('ai', () => ({
  generateText: jest.fn(),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/ai/client', () => ({
  BRIEF_MODEL: 'mock-model',
}))

// withCrmAuth: pass through as member of org-a
jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) =>
      handler(req, { orgId: 'org-a', role: 'member', isAgent: false, permissions: {} }, routeCtx),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/crm/ai/compose-email/route'
import { generateText } from 'ai'
import { adminDb } from '@/lib/firebase/admin'

const mockGenerateText = generateText as jest.Mock
const mockCollection = adminDb.collection as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/crm/ai/compose-email', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function makeContactDocMock(data: Record<string, unknown> | null) {
  return {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: data !== null,
        data: () => data ?? undefined,
      }),
    }),
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/v1/crm/ai/compose-email', () => {
  it('returns 200 with subject and bodyText on success', async () => {
    mockCollection.mockReturnValue(
      makeContactDocMock({ orgId: 'org-a', name: 'Alice', company: 'Acme', stage: 'replied', leadScore: 75 })
    )
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ subject: 'Hey Alice!', bodyText: 'Hi Alice, great to connect.' }),
    })

    const res = await POST(makeReq({ contactId: 'contact-1', purpose: 'Intro call' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.subject).toBe('Hey Alice!')
    expect(body.data.bodyText).toBe('Hi Alice, great to connect.')
  })

  it('returns 400 when contactId is missing', async () => {
    const res = await POST(makeReq({ purpose: 'Follow up' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/contactId/i)
  })

  it('returns 400 when purpose is missing', async () => {
    const res = await POST(makeReq({ contactId: 'contact-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/purpose/i)
  })

  it('returns 404 when contact does not exist', async () => {
    mockCollection.mockReturnValue(
      makeContactDocMock(null)
    )
    const res = await POST(makeReq({ contactId: 'no-such-contact', purpose: 'Test' }))
    expect(res.status).toBe(404)
  })

  it('returns 404 when contact belongs to different org', async () => {
    mockCollection.mockReturnValue(
      makeContactDocMock({ orgId: 'other-org', name: 'Bob' })
    )
    const res = await POST(makeReq({ contactId: 'contact-2', purpose: 'Test' }))
    expect(res.status).toBe(404)
  })

  it('returns 500 when generateText throws', async () => {
    mockCollection.mockReturnValue(
      makeContactDocMock({ orgId: 'org-a', name: 'Alice', stage: 'contacted', leadScore: 60 })
    )
    mockGenerateText.mockRejectedValue(new Error('Rate limit exceeded'))

    const res = await POST(makeReq({ contactId: 'contact-1', purpose: 'Test' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/AI composition failed/i)
  })
})
