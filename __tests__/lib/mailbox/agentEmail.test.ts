jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: class MockTimestamp {},
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/mailbox/sendBridge', () => ({
  sendMailboxMessage: jest.fn(async () => ({ ok: true, provider: 'google', messageId: 'sent-1', providerMessageId: 'provider-1' })),
}))

import { adminDb } from '@/lib/firebase/admin'
import { sendMailboxMessage } from '@/lib/mailbox/sendBridge'

type Doc = { id: string; data: Record<string, unknown> }
type CollectionMock = {
  doc: jest.Mock
  add: jest.Mock
  where: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  get: jest.Mock
}

function makeDoc(id: string, data: Record<string, unknown>, store: Doc[]) {
  return {
    id,
    exists: true,
    data: (): Record<string, unknown> => data,
    ref: {
      update: jest.fn(async (patch: Record<string, unknown>) => {
        const item = store.find((entry) => entry.id === id)
        if (item) item.data = { ...item.data, ...patch }
      }),
    },
  }
}

function makeCollection(store: Doc[]): CollectionMock {
  const collection: CollectionMock = {
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const found = store.find((entry) => entry.id === id)
        return found ? makeDoc(found.id, found.data, store) : { id, exists: false, data: (): undefined => undefined }
      }),
    })),
    add: jest.fn(async (data: Record<string, unknown>) => {
      const id = `auto-${store.length + 1}`
      store.push({ id, data })
      return { id, get: jest.fn(async () => makeDoc(id, data, store)) }
    }),
    where: jest.fn(function (field: string, _op: string, value: unknown) {
      return makeCollection(store.filter((entry) => entry.data[field] === value))
    }),
    orderBy: jest.fn(function () { return collection }),
    limit: jest.fn(function () { return collection }),
    get: jest.fn(async () => ({ docs: store.map((entry) => makeDoc(entry.id, entry.data, store)) })),
  }
  return collection
}

function stageCollections(stores: Record<string, Doc[]>) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    const store = stores[name]
    if (!store) throw new Error(`Unexpected collection ${name}`)
    return makeCollection(store)
  })
}

describe('agent email mailbox tool contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reads and searches only the requested org/user mailbox context', async () => {
    const messages: Doc[] = [
      { id: 'msg-1', data: { orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', folder: 'inbox', from: 'lead@example.com', to: ['me@example.com'], subject: 'Proposal question', bodyText: 'Can you send the proposal?', snippet: 'Can you send', createdAt: '2026-05-26T08:00:00Z' } },
      { id: 'msg-2', data: { orgId: 'org-1', uid: 'user-2', accountId: 'acct-2', folder: 'inbox', from: 'other@example.com', subject: 'Proposal secret', bodyText: 'Wrong user' } },
      { id: 'msg-3', data: { orgId: 'org-2', uid: 'user-1', accountId: 'acct-3', folder: 'inbox', from: 'other@example.com', subject: 'Proposal secret', bodyText: 'Wrong org' } },
    ]
    stageCollections({ mailbox_messages: messages, mailbox_accounts: [], mailbox_agent_tool_events: [], mailbox_send_requests: [] })

    const { readAgentMailboxMessages } = await import('@/lib/mailbox/agentEmail')
    const result = await readAgentMailboxMessages({ orgId: 'org-1', uid: 'user-1', q: 'proposal', folder: 'inbox', limit: 10 }, { actorId: 'agent:theo', actorType: 'agent' })

    expect(result.messages.map((message) => message.id)).toEqual(['msg-1'])
    expect(result.context).toMatchObject({ orgId: 'org-1', uid: 'user-1' })
  })

  it('summarises bounded mailbox context without leaking full bodies', async () => {
    stageCollections({
      mailbox_messages: [
        { id: 'msg-1', data: { orgId: 'org-1', uid: 'user-1', folder: 'inbox', from: 'lead@example.com', to: ['me@example.com'], subject: 'Need pricing', bodyText: 'A'.repeat(1000), snippet: 'Need pricing for package', createdAt: '2026-05-26T08:00:00Z' } },
      ],
      mailbox_accounts: [], mailbox_agent_tool_events: [], mailbox_send_requests: [],
    })

    const { summarizeAgentMailboxContext } = await import('@/lib/mailbox/agentEmail')
    const result = await summarizeAgentMailboxContext({ orgId: 'org-1', uid: 'user-1', limit: 5 }, { actorId: 'agent:theo', actorType: 'agent' })

    expect(result.summary).toContain('Need pricing')
    expect(result.items[0]).not.toHaveProperty('bodyText')
    expect(result.items[0]).toMatchObject({ id: 'msg-1', from: 'lead@example.com', snippet: 'Need pricing for package' })
  })

  it('creates drafts and replies under the requested org/user account context', async () => {
    const messages: Doc[] = [
      { id: 'source-1', data: { orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', accountEmail: 'me@example.com', folder: 'inbox', from: 'lead@example.com', to: ['me@example.com'], subject: 'Original', bodyText: 'Hi' } },
    ]
    const accounts: Doc[] = [
      { id: 'acct-1', data: { orgId: 'org-1', uid: 'user-1', emailAddress: 'me@example.com', isDefault: true, status: 'connected' } },
    ]
    stageCollections({ mailbox_messages: messages, mailbox_accounts: accounts, mailbox_agent_tool_events: [], mailbox_send_requests: [] })

    const { createAgentMailboxDraft, createAgentMailboxReplyDraft } = await import('@/lib/mailbox/agentEmail')
    const draft = await createAgentMailboxDraft({ orgId: 'org-1', uid: 'user-1', to: ['lead@example.com'], subject: 'Draft', bodyText: 'Draft body' }, { actorId: 'agent:theo', actorType: 'agent' })
    const reply = await createAgentMailboxReplyDraft({ orgId: 'org-1', uid: 'user-1', sourceMessageId: 'source-1', bodyText: 'Reply body' }, { actorId: 'agent:theo', actorType: 'agent' })

    expect(draft.message).toMatchObject({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', folder: 'drafts', to: ['lead@example.com'] })
    expect(reply.message).toMatchObject({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', folder: 'drafts', to: ['lead@example.com'], subject: 'Re: Original' })
  })

  it('rejects agent send requests without approval evidence and audits the refusal', async () => {
    const audits: Doc[] = []
    stageCollections({ mailbox_messages: [], mailbox_accounts: [], mailbox_agent_tool_events: audits, mailbox_send_requests: [] })

    const { requestAgentMailboxSend } = await import('@/lib/mailbox/agentEmail')
    await expect(requestAgentMailboxSend({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', to: ['client@example.com'], subject: 'Hello', bodyText: 'Body' }, { actorId: 'agent:theo', actorType: 'agent' })).rejects.toThrow(/approval evidence/i)

    expect(sendMailboxMessage).not.toHaveBeenCalled()
    expect(audits[0].data).toMatchObject({ action: 'send_request_rejected', orgId: 'org-1', uid: 'user-1', actor: { id: 'agent:theo', type: 'agent' } })
  })

  it('requires approval evidence, records a send request, delegates provider delivery, and audits accepted sends', async () => {
    const requests: Doc[] = []
    const audits: Doc[] = []
    stageCollections({ mailbox_messages: [], mailbox_accounts: [], mailbox_agent_tool_events: audits, mailbox_send_requests: requests })

    const { requestAgentMailboxSend } = await import('@/lib/mailbox/agentEmail')
    const result = await requestAgentMailboxSend({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', to: ['client@example.com'], subject: 'Hello', bodyText: 'Body', approvalEvidence: { approvalGateTaskId: 'gate-1', approvedBy: 'peet', approvedAt: '2026-05-26T08:30:00Z' } }, { actorId: 'agent:theo', actorType: 'agent' })

    expect(result.sendResult).toMatchObject({ ok: true, messageId: 'sent-1' })
    expect(requests[0].data).toMatchObject({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', status: 'sent', approvalEvidence: { approvalGateTaskId: 'gate-1' } })
    expect(sendMailboxMessage).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', uid: 'user-1', accountId: 'acct-1', approved: true, actorId: 'agent:theo', actorType: 'agent', approvalGateTaskId: 'gate-1' }))
    expect(audits[audits.length - 1].data).toMatchObject({ action: 'send_request_accepted', orgId: 'org-1', uid: 'user-1', requestId: 'auto-1' })
  })
})
