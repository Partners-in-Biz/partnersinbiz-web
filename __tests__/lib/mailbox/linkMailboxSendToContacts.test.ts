jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

import { adminDb } from '@/lib/firebase/admin'
import {
  findOrgContactsByEmails,
  linkMailboxSendToContacts,
  normalizeRecipientEmails,
  recipientEmailsForCrmTouch,
} from '@/lib/mailbox/linkMailboxSendToContacts'

type Doc = { id: string; data: Record<string, unknown> }

function makeDoc(id: string, data: Record<string, unknown>, store: Doc[]) {
  return {
    id,
    ref: {
      id,
      update: jest.fn(async (patch: Record<string, unknown>) => {
        const existing = store.find((item) => item.id === id)
        if (existing) existing.data = { ...existing.data, ...patch }
        else store.push({ id, data: patch })
      }),
      set: jest.fn(async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
        const existing = store.find((item) => item.id === id)
        if (existing && options?.merge) existing.data = { ...existing.data, ...patch }
        else if (existing) existing.data = patch
        else store.push({ id, data: patch })
      }),
    },
    exists: true,
    data: () => data,
  }
}

function makeCollection(store: Doc[]) {
  const collection: any = {
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const found = store.find((item) => item.id === id)
        return found
          ? makeDoc(found.id, found.data, store)
          : { id, exists: false, data: () => undefined, ref: makeDoc(id, {}, store).ref }
      }),
      update: jest.fn(async (patch: Record<string, unknown>) => {
        const existing = store.find((item) => item.id === id)
        if (existing) existing.data = { ...existing.data, ...patch }
        else store.push({ id, data: patch })
      }),
      set: jest.fn(async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
        const existing = store.find((item) => item.id === id)
        if (existing && options?.merge) existing.data = { ...existing.data, ...patch }
        else if (existing) existing.data = patch
        else store.push({ id, data: patch })
      }),
    })),
    add: jest.fn(async (data: Record<string, unknown>) => {
      const id = `act-${store.length + 1}`
      store.push({ id, data })
      return { id }
    }),
    where: jest.fn(function (field: string, _op: string, value: unknown) {
      const filtered = store.filter((item) => item.data[field] === value)
      return makeCollection(filtered)
    }),
    limit: jest.fn(function (n: number) {
      const limited = store.slice(0, n)
      return makeCollection(limited)
    }),
    get: jest.fn(async () => ({ docs: store.map((item) => makeDoc(item.id, item.data, store)) })),
  }
  return collection
}

describe('normalizeRecipientEmails / recipientEmailsForCrmTouch', () => {
  it('normalises, dedupes, and drops invalid', () => {
    expect(normalizeRecipientEmails([
      '  Alice@Example.com ',
      'alice@example.com',
      'bob@example.com',
      'not-an-email',
      '',
    ])).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('uses to+cc and excludes bcc', () => {
    expect(recipientEmailsForCrmTouch({
      to: ['a@x.com'],
      cc: ['b@x.com', 'a@x.com'],
    })).toEqual(['a@x.com', 'b@x.com'])
  })
})

describe('findOrgContactsByEmails', () => {
  it('returns non-deleted contacts for org+email', async () => {
    const contacts: Doc[] = [
      { id: 'c1', data: { orgId: 'org-1', email: 'client@example.com', name: 'Client', companyId: 'co-1', deleted: false } },
      { id: 'c2', data: { orgId: 'org-1', email: 'gone@example.com', deleted: true } },
    ]
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'contacts') return makeCollection(contacts)
      throw new Error(`unexpected ${name}`)
    })

    const matched = await findOrgContactsByEmails('org-1', ['client@example.com', 'gone@example.com', 'missing@example.com'])
    expect(matched).toEqual([
      { contactId: 'c1', email: 'client@example.com', companyId: 'co-1', name: 'Client' },
    ])
  })
})

describe('linkMailboxSendToContacts', () => {
  it('writes contact activity, bumps lastContactedAt, stamps mailbox message', async () => {
    const contacts: Doc[] = [
      { id: 'c1', data: { orgId: 'org-1', email: 'client@example.com', name: 'Client', companyId: 'co-1' } },
    ]
    const activities: Doc[] = []
    const messages: Doc[] = [
      { id: 'msg-1', data: { orgId: 'org-1', subject: 'Hello' } },
    ]
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'contacts') return makeCollection(contacts)
      if (name === 'activities') return makeCollection(activities)
      if (name === 'mailbox_messages') return makeCollection(messages)
      throw new Error(`unexpected ${name}`)
    })

    const result = await linkMailboxSendToContacts({
      orgId: 'org-1',
      uid: 'uid-1',
      accountId: 'acct-1',
      mailboxMessageId: 'msg-1',
      provider: 'google',
      providerMessageId: 'gmail-1',
      threadId: 'thread-1',
      subject: 'Hello',
      bodySnippet: 'Body preview',
      to: ['client@example.com'],
      actorId: 'uid-1',
      actorType: 'user',
    })

    expect(result.contactIds).toEqual(['c1'])
    expect(result.activityIds).toHaveLength(1)
    expect(activities[0].data).toMatchObject({
      orgId: 'org-1',
      contactId: 'c1',
      companyId: 'co-1',
      type: 'email_sent',
      summary: 'Email sent: Hello',
      mailboxMessageId: 'msg-1',
      providerMessageId: 'gmail-1',
      metadata: expect.objectContaining({
        source: 'mailbox_send_bridge',
        providerMessageId: 'gmail-1',
        to: 'client@example.com',
      }),
    })
    expect(contacts[0].data.lastContactedAt).toBe('SERVER_TIMESTAMP')
    expect(messages[0].data.linkedContactIds).toEqual(['c1'])
  })

  it('returns empty when no CRM contact matches', async () => {
    const contacts: Doc[] = []
    const activities: Doc[] = []
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'contacts') return makeCollection(contacts)
      if (name === 'activities') return makeCollection(activities)
      throw new Error(`unexpected ${name}`)
    })

    const result = await linkMailboxSendToContacts({
      orgId: 'org-1',
      uid: 'uid-1',
      accountId: 'acct-1',
      mailboxMessageId: 'msg-1',
      provider: 'google',
      subject: 'Hello',
      to: ['unknown@example.com'],
    })

    expect(result).toEqual({ contactIds: [], activityIds: [] })
    expect(activities).toHaveLength(0)
  })
})
