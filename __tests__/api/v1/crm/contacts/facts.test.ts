jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (_role: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) =>
      handler(
        req,
        {
          orgId: 'org-a',
          role: 'member',
          isAgent: false,
          uid: 'user-1',
          actor: { uid: 'user-1', displayName: 'Rep', kind: 'human' },
          permissions: {},
        },
        routeCtx,
      ),
}))

jest.mock('@/lib/crm/live-updates', () => ({
  safeTouchCrmLiveUpdate: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/crm/facts', () => {
  const actualEvidence = jest.requireActual('@/lib/crm/facts/evidence')
  const fields = jest.requireActual('@/lib/crm/facts/fields')
  return {
    ...actualEvidence,
    ...fields,
    FACT_FIELDS: fields.FACT_FIELDS,
    EVIDENCE_KINDS: actualEvidence.EVIDENCE_KINDS,
    isEvidenceKind: actualEvidence.isEvidenceKind,
    isFactField: fields.isFactField,
    listContactFacts: jest.fn().mockResolvedValue([]),
    loadAccessibleFactContact: jest.fn().mockResolvedValue({
      ok: true,
      contact: { id: 'contact-1', orgId: 'org-a', name: 'Jane', email: 'jane@acme.com' },
    }),
    recordContactFact: jest.fn().mockResolvedValue({
      stored: true,
      applied: false,
      band: 'PROBABLE',
      score: 0.8,
      rationale: 'Their own email signature says so',
      factId: 'fact-1',
    }),
  }
})

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/v1/crm/contacts/[id]/facts/route'
import { recordContactFact } from '@/lib/crm/facts'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CRM contact facts API', () => {
  it('rejects model confidence/score/band on POST', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/contacts/contact-1/facts', {
      method: 'POST',
      body: JSON.stringify({
        field: 'title',
        value: 'CEO',
        confidence: 0.9,
        evidence: [{ kind: 'crm.signature-block', detail: 'sig says CEO' }],
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error || '')).toMatch(/confidence|score|band/i)
    expect(recordContactFact).not.toHaveBeenCalled()
  })

  it('records observation-backed fact without confidence', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/contacts/contact-1/facts', {
      method: 'POST',
      body: JSON.stringify({
        field: 'title',
        value: 'Head of Security',
        method: 'crm.thread',
        evidence: [{ kind: 'crm.signature-block', detail: 'signature says Head of Security' }],
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact-1' }) })
    expect(res.status).toBe(201)
    expect(recordContactFact).toHaveBeenCalled()
    const arg = (recordContactFact as jest.Mock).mock.calls[0][0]
    expect(arg.field).toBe('title')
    expect(arg.evidence[0].kind).toBe('crm.signature-block')
    expect(arg).not.toHaveProperty('confidence')
  })

  it('lists facts for accessible contact', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/contacts/contact-1/facts')
    const res = await GET(req, { params: Promise.resolve({ id: 'contact-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.facts).toEqual([])
  })
})
