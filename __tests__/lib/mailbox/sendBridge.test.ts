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

type Doc = { id: string; data: Record<string, unknown> }
type CollectionMock = {
  doc: jest.Mock
  add: jest.Mock
  where: jest.Mock
  get: jest.Mock
}

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
  const collection: CollectionMock & { limit: jest.Mock; update?: jest.Mock } = {
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
    limit: jest.fn(function (n: number) {
      return makeCollection(store.slice(0, n))
    }),
    get: jest.fn(async () => ({ docs: store.map((item) => makeDoc(item.id, item.data, store)) })),
  }
  return collection
}

function stageCollections(
  accounts: Doc[],
  messages: Doc[],
  activities: Doc[] = [],
  audits: Doc[] = [],
  contacts: Doc[] = [],
) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'mailbox_accounts') return makeCollection(accounts)
    if (name === 'mailbox_messages') return makeCollection(messages)
    if (name === 'activities') return makeCollection(activities)
    if (name === 'mailbox_audit_events') return makeCollection(audits)
    if (name === 'contacts') return makeCollection(contacts)
    throw new Error(`Unexpected collection ${name}`)
  })
}

describe('sendMailboxMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
  })

  it('fails closed and does not persist or call providers when send approval is missing', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    stageCollections(accounts, messages)
    global.fetch = jest.fn() as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', approved: false, to: ['client@example.com'], subject: 'Hello', bodyText: 'Body' })

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/approved/i) })
    expect(messages).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('supports dry-run no-send path without calling Gmail or persisting a sent record', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', displayName: 'Me', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    const audits: Doc[] = []
    stageCollections(accounts, messages, [], audits)
    global.fetch = jest.fn() as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', approved: true, dryRun: true, to: ['client@example.com'], subject: 'Hello', bodyText: 'Body' })

    expect(result).toMatchObject({ ok: true, dryRun: true, provider: 'google' })
    expect(messages).toHaveLength(0)
    expect(audits[0].data).toMatchObject({ action: 'send_dry_run', orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', approved: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends Gmail-first through linked Google account and persists provider ids on sent mailbox record', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', displayName: 'Me', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    const activities: Doc[] = []
    const audits: Doc[] = []
    stageCollections(accounts, messages, activities, audits)
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token' })
      const raw = JSON.parse(String(init?.body)).raw
      const mime = Buffer.from(raw, 'base64url').toString('utf8')
      expect(mime).toContain('Subject: Hello')
      expect(mime).not.toContain('=?UTF-8?B?')
      return { ok: true, json: async () => ({ id: 'gmail-sent-1', threadId: 'thread-1', labelIds: ['SENT'] }) }
    }) as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', approved: true, to: ['client@example.com'], subject: 'Hello', bodyText: 'Body' })

    expect(result).toMatchObject({ ok: true, provider: 'google', providerMessageId: 'gmail-sent-1', threadId: 'thread-1' })
    expect(messages).toHaveLength(1)
    expect(messages[0].data).toMatchObject({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', folder: 'sent', status: 'sent', provider: 'google', providerMessageId: 'gmail-sent-1', threadId: 'thread-1', from: 'me@example.com', to: ['client@example.com'], subject: 'Hello' })
    expect(activities[0].data).toMatchObject({ orgId: 'org-1', type: 'email_sent', source: 'mailbox_send_bridge' })
    expect(audits[0].data).toMatchObject({ action: 'send_success', provider: 'google', providerMessageId: 'gmail-sent-1' })
  })

  it('links matched CRM contact on send: contact activity + lastContactedAt + Gmail id metadata', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    const activities: Doc[] = []
    const audits: Doc[] = []
    const contacts: Doc[] = [
      { id: 'contact-kgaugelo', data: { orgId: 'org-1', email: 'client@example.com', name: 'Kgaugelo', companyId: 'co-1', deleted: false } },
    ]
    stageCollections(accounts, messages, activities, audits, contacts)
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'gmail-sent-crm', threadId: 'thread-crm' }),
    })) as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({
      orgId: 'org-1',
      uid: 'uid-1',
      accountId: 'acct-1',
      approved: true,
      to: ['Client@Example.com'],
      subject: 'Website project',
      bodyText: 'Quick question…',
    })

    expect(result).toMatchObject({ ok: true, providerMessageId: 'gmail-sent-crm' })
    // org-level + contact-scoped
    expect(activities.length).toBeGreaterThanOrEqual(2)
    const contactActivity = activities.find((row) => row.data.contactId === 'contact-kgaugelo')
    expect(contactActivity?.data).toMatchObject({
      type: 'email_sent',
      contactId: 'contact-kgaugelo',
      companyId: 'co-1',
      summary: 'Email sent: Website project',
      providerMessageId: 'gmail-sent-crm',
      mailboxMessageId: messages[0].id,
    })
    expect(contacts[0].data.lastContactedAt).toBe('SERVER_TIMESTAMP')
    expect(messages[0].data.linkedContactIds).toEqual(['contact-kgaugelo'])
    expect(messages[0].data.providerMessageId).toBe('gmail-sent-crm')
  })

  it('includes sanitized attachments in Gmail MIME payload and stores only attachment metadata', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    stageCollections(accounts, messages)
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const raw = JSON.parse(String(init?.body)).raw
      const mime = Buffer.from(raw, 'base64url').toString('utf8')
      expect(mime).toContain('Content-Type: multipart/mixed;')
      expect(mime).toContain('Content-Disposition: attachment; filename="brief.txt"')
      expect(mime).toContain(Buffer.from('Attachment body').toString('base64'))
      return { ok: true, json: async () => ({ id: 'gmail-sent-attachment', threadId: 'thread-attach' }) }
    }) as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({
      orgId: 'org-1',
      uid: 'uid-1',
      accountId: 'acct-1',
      approved: true,
      to: ['client@example.com'],
      subject: 'With attachment',
      bodyText: 'See attached',
      attachments: [{ name: 'brief.txt', contentType: 'text/plain', sizeBytes: 15, contentBase64: Buffer.from('Attachment body').toString('base64') }],
    })

    expect(result).toMatchObject({ ok: true, provider: 'google', providerMessageId: 'gmail-sent-attachment' })
    expect(messages[0].data.attachments).toEqual([{ name: 'brief.txt', contentType: 'text/plain', sizeBytes: 15 }])
  })

  it('RFC 2047-encodes non-ASCII subjects in the Gmail raw MIME payload', async () => {
    const subject = 'Invoice SAA-002 — Deposit — Saaiman Stays Platform Build'
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'google', status: 'connected', emailAddress: 'me@example.com', googleEnc: { credentials: { accessToken: 'token', expiresAt: Date.now() + 600_000 } } } }]
    const messages: Doc[] = []
    stageCollections(accounts, messages)
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const raw = JSON.parse(String(init?.body)).raw
      const mime = Buffer.from(raw, 'base64url').toString('utf8')
      const subjectLine = mime.split('\r\n').find((line) => line.startsWith('Subject: '))
      expect(subjectLine).toBeDefined()
      expect(subjectLine).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
      expect(subjectLine).not.toContain('—')
      const encodedWord = subjectLine!.slice('Subject: '.length)
      const b64 = encodedWord.slice('=?UTF-8?B?'.length, -'?='.length)
      expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(subject)
      expect(mime).toContain('Invoice: SAA-002 — Deposit — Saaiman Stays Platform Build')
      return { ok: true, json: async () => ({ id: 'gmail-sent-rfc2047', threadId: 'thread-rfc2047' }) }
    }) as unknown as typeof fetch

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({
      orgId: 'org-1',
      uid: 'uid-1',
      accountId: 'acct-1',
      approved: true,
      to: ['client@example.com'],
      subject,
      bodyText: 'Invoice: SAA-002 — Deposit — Saaiman Stays Platform Build',
    })

    expect(result).toMatchObject({ ok: true, provider: 'google', providerMessageId: 'gmail-sent-rfc2047' })
    expect(messages[0].data.subject).toBe(subject)
  })

  it('sends through configured SMTP account when SMTP credentials are present', async () => {
    const accounts: Doc[] = [{ id: 'acct-1', data: { orgId: 'org-1', uid: 'uid-1', provider: 'smtp_imap', status: 'connected', emailAddress: 'me@example.com', smtpEnc: { credentials: { host: 'smtp.example.com', port: 465, username: 'me@example.com', password: 'secret', secure: true } } } }]
    const messages: Doc[] = []
    stageCollections(accounts, messages)
    const smtpSend = jest.fn(async () => ({ messageId: 'smtp-msg-1', response: '250 ok' }))

    const { sendMailboxMessage } = await import('@/lib/mailbox/sendBridge')
    const result = await sendMailboxMessage({ orgId: 'org-1', uid: 'uid-1', accountId: 'acct-1', approved: true, to: ['client@example.com'], subject: 'SMTP hello', bodyText: 'SMTP body' }, { smtpSend })

    expect(result).toMatchObject({ ok: true, provider: 'smtp', providerMessageId: 'smtp-msg-1' })
    expect(smtpSend).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 465 }), expect.objectContaining({ from: 'me@example.com', to: ['client@example.com'], subject: 'SMTP hello' }))
    expect(messages[0].data).toMatchObject({ provider: 'smtp', providerMessageId: 'smtp-msg-1', folder: 'sent', status: 'sent' })
  })
})
