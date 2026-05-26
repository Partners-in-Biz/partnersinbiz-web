import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { adminDb } from '@/lib/firebase/admin'
import { GET } from '@/app/api/v1/agent/email/messages/route'

process.env.AI_API_KEY = 'legacy-test-key'

type Doc = { id: string; data: Record<string, unknown> }

function makeCollection(store: Doc[]) {
  return {
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const found = store.find((entry) => entry.id === id)
        return found ? { id: found.id, exists: true, data: () => found.data } : { id, exists: false, data: () => undefined }
      }),
    })),
    where: jest.fn((field: string, _op: string, value: unknown) => makeCollection(store.filter((entry) => entry.data[field] === value))),
    get: jest.fn(async () => ({ docs: store.map((entry) => ({ id: entry.id, data: () => entry.data })) })),
    add: jest.fn(async (data: Record<string, unknown>) => {
      const id = `auto-${store.length + 1}`
      store.push({ id, data })
      return { id }
    }),
  }
}

function stageCollections(stores: Record<string, Doc[]>) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    const store = stores[name]
    if (!store) throw new Error(`Unexpected collection ${name}`)
    return makeCollection(store)
  })
}

function makeReq(query: string) {
  return new NextRequest(`http://localhost/api/v1/agent/email/messages?${query}`, {
    headers: { authorization: 'Bearer legacy-test-key' },
  })
}

describe('GET /api/v1/agent/email/messages delegation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects legacy ai credentials that guess a uid without machine-checkable delegation evidence', async () => {
    stageCollections({ mailbox_agent_delegations: [], mailbox_messages: [], mailbox_agent_tool_events: [] })

    const res = await GET(makeReq('orgId=org-1&uid=user-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/delegation evidence/i)
  })

  it('accepts a scoped delegation record and audits the delegated uid and evidence id', async () => {
    const audits: Doc[] = []
    stageCollections({
      mailbox_agent_delegations: [
        { id: 'delegation-1', data: { orgId: 'org-1', uid: 'user-1', actorId: 'ai-agent', status: 'active', actionClasses: ['read'] } },
      ],
      mailbox_messages: [
        { id: 'msg-1', data: { orgId: 'org-1', uid: 'user-1', folder: 'inbox', from: 'lead@example.com', to: ['me@example.com'], subject: 'Hello', snippet: 'Hello', createdAt: '2026-05-26T08:00:00Z' } },
        { id: 'msg-2', data: { orgId: 'org-1', uid: 'user-2', folder: 'inbox', from: 'other@example.com', subject: 'Secret', snippet: 'Secret' } },
      ],
      mailbox_agent_tool_events: audits,
    })

    const res = await GET(makeReq('orgId=org-1&uid=user-1&delegationEvidenceId=delegation-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.messages.map((message: { id: string }) => message.id)).toEqual(['msg-1'])
    expect(audits[0].data).toMatchObject({
      orgId: 'org-1',
      uid: 'user-1',
      delegatedUid: 'user-1',
      actor: { id: 'ai-agent', type: 'agent' },
      delegationEvidence: { id: 'delegation-1', type: 'delegation_record', actionClass: 'read' },
    })
  })
})
