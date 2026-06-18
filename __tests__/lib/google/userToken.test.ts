jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))
jest.mock('@/lib/integrations/crypto', () => ({
  decryptCredentials: jest.fn((value: Record<string, unknown>) => (value as { credentials: unknown }).credentials),
  encryptCredentials: jest.fn((credentials: Record<string, unknown>) => ({ encrypted: true, credentials })),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: jest.fn(() => 'TS') } }))

import { adminDb } from '@/lib/firebase/admin'
import { encryptCredentials } from '@/lib/integrations/crypto'

type Doc = { id: string; data: Record<string, unknown> }
function makeAccountRef(id: string, store: Doc[]) {
  return {
    id,
    get: jest.fn(async () => {
      const f = store.find((d) => d.id === id)
      return f ? { exists: true, data: () => f.data, ref: makeAccountRef(id, store) } : { exists: false, data: () => undefined, ref: makeAccountRef(id, store) }
    }),
    set: jest.fn(async (patch: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const f = store.find((d) => d.id === id)
      if (f && opts?.merge) f.data = { ...f.data, ...patch }
      else if (f) f.data = patch
      else store.push({ id, data: patch })
    }),
  }
}
function makeCollection(store: Doc[]) {
  return {
    doc: jest.fn((id: string) => makeAccountRef(id, store)),
    where: jest.fn(function (field: string, _op: string, value: unknown) {
      const filtered = store.filter((d) => d.data[field] === value)
      const col = makeCollection(filtered) as Record<string, unknown>
      col.get = jest.fn(async () => ({ empty: filtered.length === 0, docs: filtered.map((d) => ({ id: d.id, data: () => d.data })) }))
      col.limit = jest.fn(() => col)
      return col
    }),
  }
}

describe('getFreshGoogleAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret'
  })

  it('returns the existing access token when it is still valid', async () => {
    const accounts: Doc[] = [{ id: 'a1', data: { orgId: 'org-1', uid: 'u1', provider: 'google', status: 'connected', googleEnc: { credentials: { accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 600_000, scope: 'openid https://www.googleapis.com/auth/calendar.events' } } } }]
    ;(adminDb.collection as jest.Mock).mockImplementation((n: string) => { if (n === 'mailbox_accounts') return makeCollection(accounts); throw new Error(n) })
    const { getFreshGoogleAccessToken } = await import('@/lib/google/userToken')
    const result = await getFreshGoogleAccessToken({ orgId: 'org-1', uid: 'u1', accountId: 'a1' })
    expect(result).toMatchObject({ ok: true, accessToken: 'good' })
    expect((result as { scopes: string[] }).scopes).toContain('https://www.googleapis.com/auth/calendar.events')
  })

  it('refreshes an expired token and persists the new encrypted credentials', async () => {
    const accounts: Doc[] = [{ id: 'a1', data: { orgId: 'org-1', uid: 'u1', provider: 'google', status: 'connected', googleEnc: { credentials: { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1, scope: 'openid' } } } }]
    ;(adminDb.collection as jest.Mock).mockImplementation((n: string) => { if (n === 'mailbox_accounts') return makeCollection(accounts); throw new Error(n) })
    global.fetch = jest.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' }) }
      throw new Error(url)
    }) as unknown as typeof fetch
    const { getFreshGoogleAccessToken } = await import('@/lib/google/userToken')
    const result = await getFreshGoogleAccessToken({ orgId: 'org-1', uid: 'u1', accountId: 'a1' })
    expect(result).toMatchObject({ ok: true, accessToken: 'fresh' })
    expect(encryptCredentials).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh' }), 'org-1')
  })

  it('returns needsReconnect when the refresh fails', async () => {
    const accounts: Doc[] = [{ id: 'a1', data: { orgId: 'org-1', uid: 'u1', provider: 'google', status: 'connected', googleEnc: { credentials: { accessToken: 'old', refreshToken: 'bad', expiresAt: Date.now() - 1 } } } }]
    ;(adminDb.collection as jest.Mock).mockImplementation((n: string) => { if (n === 'mailbox_accounts') return makeCollection(accounts); throw new Error(n) })
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })) as unknown as typeof fetch
    const { getFreshGoogleAccessToken } = await import('@/lib/google/userToken')
    const result = await getFreshGoogleAccessToken({ orgId: 'org-1', uid: 'u1', accountId: 'a1' })
    expect(result).toMatchObject({ ok: false, needsReconnect: true })
  })

  it('returns notConnected when the user has no google account', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((n: string) => { if (n === 'mailbox_accounts') return makeCollection([]); throw new Error(n) })
    const { getFreshGoogleAccessToken } = await import('@/lib/google/userToken')
    const result = await getFreshGoogleAccessToken({ orgId: 'org-1', uid: 'u1' })
    expect(result).toMatchObject({ ok: false, notConnected: true })
  })
})

describe('googleAccountHasScopes', () => {
  const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
  const CAL_FULL = 'https://www.googleapis.com/auth/calendar'
  const DRIVE_META_RO = 'https://www.googleapis.com/auth/drive.metadata.readonly'
  const DRIVE_FULL = 'https://www.googleapis.com/auth/drive'
  const DRIVE_RO = 'https://www.googleapis.com/auth/drive.readonly'

  it('matches when the exact required scope is granted', async () => {
    const { googleAccountHasScopes } = await import('@/lib/google/userToken')
    expect(googleAccountHasScopes([CAL_EVENTS], [CAL_EVENTS])).toBe(true)
  })

  it('treats full calendar scope as satisfying calendar.events', async () => {
    const { googleAccountHasScopes } = await import('@/lib/google/userToken')
    expect(googleAccountHasScopes([CAL_FULL], [CAL_EVENTS])).toBe(true)
  })

  it('treats full drive scope as satisfying drive.metadata.readonly', async () => {
    const { googleAccountHasScopes } = await import('@/lib/google/userToken')
    expect(googleAccountHasScopes([DRIVE_FULL], [DRIVE_META_RO])).toBe(true)
  })

  it('treats drive.readonly as satisfying drive.metadata.readonly', async () => {
    const { googleAccountHasScopes } = await import('@/lib/google/userToken')
    expect(googleAccountHasScopes([DRIVE_RO], [DRIVE_META_RO])).toBe(true)
  })

  it('returns false when neither the scope nor a broader parent is granted', async () => {
    const { googleAccountHasScopes } = await import('@/lib/google/userToken')
    expect(googleAccountHasScopes(['https://www.googleapis.com/auth/gmail.readonly'], [CAL_EVENTS])).toBe(false)
  })
})
