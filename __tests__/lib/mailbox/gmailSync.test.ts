jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/integrations/crypto', () => ({
  decryptCredentials: jest.fn((value: Record<string, unknown>) => value.credentials),
  encryptCredentials: jest.fn((credentials: Record<string, unknown>) => ({ encrypted: true, credentials })),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

import { adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, encryptCredentials } from '@/lib/integrations/crypto'

type Doc = { id: string; data: Record<string, unknown> }

function makeDoc(id: string, data: Record<string, unknown>, store: Doc[]) {
  return {
    id,
    ref: {
      id,
      set: jest.fn(async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
        const existing = store.find((item) => item.id === id)
        if (existing && options?.merge) existing.data = { ...existing.data, ...patch }
        else if (existing) existing.data = patch
        else store.push({ id, data: patch })
      }),
      update: jest.fn(async (patch: Record<string, unknown>) => {
        const existing = store.find((item) => item.id === id)
        if (existing) existing.data = { ...existing.data, ...patch }
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
        return found ? makeDoc(found.id, found.data, store) : { id, exists: false, data: () => undefined, ref: makeDoc(id, {}, store).ref }
      }),
      set: jest.fn(async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
        const existing = store.find((item) => item.id === id)
        if (existing && options?.merge) existing.data = { ...existing.data, ...patch }
        else if (existing) existing.data = patch
        else store.push({ id, data: patch })
      }),
      update: jest.fn(async (patch: Record<string, unknown>) => {
        const existing = store.find((item) => item.id === id)
        if (existing) existing.data = { ...existing.data, ...patch }
        else store.push({ id, data: patch })
      }),
    })),
    add: jest.fn(async (data: Record<string, unknown>) => {
      const id = `auto-${store.length + 1}`
      store.push({ id, data })
      return { id, get: jest.fn(async () => makeDoc(id, data, store)) }
    }),
    where: jest.fn(function (field: string, _op: string, value: unknown) {
      const filtered = store.filter((item) => item.data[field] === value)
      return makeCollection(filtered)
    }),
    get: jest.fn(async () => ({ docs: store.map((item) => makeDoc(item.id, item.data, store)) })),
  }
  return collection
}

function gmailMessage(id: string, labelIds: string[], headers: Array<{ name: string; value: string }>, body = 'Hello from Gmail') {
  return {
    id,
    threadId: 'thread-1',
    labelIds,
    snippet: body,
    internalDate: String(Date.parse('2026-05-26T06:00:00.000Z')),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: Buffer.from(body, 'utf8').toString('base64url') },
    },
  }
}

describe('syncGmailMailboxAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'
  })

  it('imports inbox and sent Gmail messages into org/user/account scoped mailbox records and dedupes provider ids', async () => {
    const accounts: Doc[] = [{
      id: 'acct-1',
      data: {
        orgId: 'org-1',
        uid: 'uid-1',
        profileId: 'org-1_uid-1',
        provider: 'google',
        emailAddress: 'me@example.com',
        displayName: 'Me',
        status: 'connected',
        googleEnc: { credentials: { accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 600_000 } },
      },
    }]
    const messages: Doc[] = [{
      id: 'existing',
      data: {
        orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', providerMessageId: 'gmail-in-1',
        subject: 'Old subject', folder: 'inbox', direction: 'inbound', status: 'received', from: 'old@example.com', to: [], cc: [], bcc: [], bodyText: '', snippet: '', read: true, starred: false,
      },
    }]
    const threads: Doc[] = []
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'mailbox_accounts') return makeCollection(accounts)
      if (name === 'mailbox_messages') return makeCollection(messages)
      if (name === 'mailbox_threads') return makeCollection(threads)
      throw new Error(`Unexpected collection ${name}`)
    })

    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/messages?') && url.includes('in%3Ainbox')) return { ok: true, json: async () => ({ messages: [{ id: 'gmail-in-1' }] }) }
      if (url.includes('/messages?') && url.includes('in%3Asent')) return { ok: true, json: async () => ({ messages: [{ id: 'gmail-sent-1' }] }) }
      if (url.endsWith('/messages/gmail-in-1?format=full')) return { ok: true, json: async () => gmailMessage('gmail-in-1', ['INBOX', 'UNREAD', 'STARRED'], [
        { name: 'From', value: 'Client <client@example.com>' },
        { name: 'To', value: 'Me <me@example.com>' },
        { name: 'Subject', value: 'Inbound subject' },
        { name: 'Date', value: 'Tue, 26 May 2026 06:00:00 +0000' },
      ]) }
      if (url.endsWith('/messages/gmail-sent-1?format=full')) return { ok: true, json: async () => gmailMessage('gmail-sent-1', ['SENT'], [
        { name: 'From', value: 'Me <me@example.com>' },
        { name: 'To', value: 'Client <client@example.com>, Other <other@example.com>' },
        { name: 'Subject', value: 'Sent subject' },
      ], 'Sent body') }
      throw new Error(`Unexpected fetch ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { syncGmailMailboxAccount } = await import('@/lib/mailbox/gmailSync')
    const result = await syncGmailMailboxAccount({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', mode: 'backfill', maxResults: 10 })

    expect(result).toMatchObject({ ok: true, imported: 1, updated: 1, skipped: 0, needsReconnect: false })
    expect(messages).toHaveLength(2)
    expect(messages.find((item) => item.id === 'existing')!.data).toMatchObject({
      orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', accountEmail: 'me@example.com',
      folder: 'inbox', direction: 'inbound', status: 'received', read: false, starred: true,
      from: 'client@example.com', to: ['me@example.com'], subject: 'Inbound subject', providerMessageId: 'gmail-in-1', threadId: 'thread-1',
    })
    expect(messages.find((item) => item.data.providerMessageId === 'gmail-sent-1')!.data).toMatchObject({
      orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', folder: 'sent', direction: 'outbound', status: 'sent',
      from: 'me@example.com', to: ['client@example.com', 'other@example.com'], subject: 'Sent subject', bodyText: 'Sent body',
    })
    expect(threads).toHaveLength(1)
    expect(threads[0].data).toMatchObject({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', providerThreadId: 'thread-1', messageCount: 2 })
  })

  it('refreshes expired Gmail access tokens and persists refreshed encrypted credentials before syncing', async () => {
    const accounts: Doc[] = [{
      id: 'acct-1',
      data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', emailAddress: 'me@example.com', status: 'connected', googleEnc: { credentials: { accessToken: 'expired', refreshToken: 'refresh-token', expiresAt: Date.now() - 1 } } },
    }]
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'mailbox_accounts') return makeCollection(accounts)
      if (name === 'mailbox_messages') return makeCollection([])
      if (name === 'mailbox_threads') return makeCollection([])
      throw new Error(`Unexpected collection ${name}`)
    })
    global.fetch = jest.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'fresh-token', expires_in: 3600, token_type: 'Bearer' }) }
      if (url.includes('/messages?')) return { ok: true, json: async () => ({ messages: [] }) }
      throw new Error(`Unexpected fetch ${url}`)
    }) as unknown as typeof fetch

    const { syncGmailMailboxAccount } = await import('@/lib/mailbox/gmailSync')
    const result = await syncGmailMailboxAccount({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1' })

    expect(result.ok).toBe(true)
    const messageListUrls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/messages?'))
    expect(messageListUrls).toEqual(expect.arrayContaining([
      expect.stringContaining('q=in%3Ainbox+newer_than%3A30d'),
      expect.stringContaining('q=in%3Asent+newer_than%3A30d'),
    ]))
    expect(messageListUrls.every((url) => url.includes('maxResults=100'))).toBe(true)
    expect(encryptCredentials).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-token', refreshToken: 'refresh-token' }), 'org-1')
    expect(accounts[0].data.googleEnc).toMatchObject({ credentials: expect.objectContaining({ accessToken: 'fresh-token' }) })
    expect(accounts[0].data.status).toBe('connected')
  })

  it('marks the account needs_setup when Gmail credentials cannot be refreshed', async () => {
    const accounts: Doc[] = [{
      id: 'acct-1',
      data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', emailAddress: 'me@example.com', status: 'connected', googleEnc: { credentials: { accessToken: 'expired', refreshToken: 'bad-refresh', expiresAt: Date.now() - 1 } } },
    }]
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'mailbox_accounts') return makeCollection(accounts)
      if (name === 'mailbox_messages') return makeCollection([])
      if (name === 'mailbox_threads') return makeCollection([])
      throw new Error(`Unexpected collection ${name}`)
    })
    global.fetch = jest.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }
      throw new Error(`Unexpected fetch ${url}`)
    }) as unknown as typeof fetch

    const { syncGmailMailboxAccount } = await import('@/lib/mailbox/gmailSync')
    const result = await syncGmailMailboxAccount({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1' })

    expect(result).toMatchObject({ ok: false, needsReconnect: true, error: expect.stringMatching(/reconnect/i) })
    expect(accounts[0].data.status).toBe('needs_setup')
    expect(decryptCredentials).toHaveBeenCalled()
  })
})
