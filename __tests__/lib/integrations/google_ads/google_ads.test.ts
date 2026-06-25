// __tests__/lib/integrations/google_ads/google_ads.test.ts
//
// Unit tests for the Google Ads adapter. We mock `fetch`, the metrics writer,
// the property loader and the meta saver — no Firestore, no real network.

// 64-char hex master key (matches the social/encryption format).
process.env.SOCIAL_TOKEN_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// firebase-admin shim — we never call Firestore in these tests, but the
// module is imported transitively via @/lib/integrations/connections etc.
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false })),
        set: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
        delete: jest.fn(async () => undefined),
      })),
    })),
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn(async () => undefined),
    })),
    runTransaction: jest.fn(async () => undefined),
    collectionGroup: jest.fn(() => ({
      where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })),
      get: jest.fn(async () => ({ docs: [] })),
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__SERVER_TS__',
  },
}))

import type { Connection } from '@/lib/integrations/types'
import { encryptCredentials } from '@/lib/integrations/crypto'
import {
  buildDailyGaql,
  GOOGLE_ADS_DAILY_GAQL_FIELDS,
  normalizeCurrency,
} from '@/lib/integrations/google_ads/schema'
import {
  beginOAuth,
  GOOGLE_AUTHORIZE_ENDPOINT,
  GOOGLE_ADS_SCOPES,
  stripCustomerIdDashes,
  readDeveloperToken,
  readLoginCustomerId,
  exchangeCodeForTokens,
  refreshAccessToken,
} from '@/lib/integrations/google_ads/oauth'
import {
  createGoogleAdsClient,
  GoogleAdsApiError,
} from '@/lib/integrations/google_ads/client'
import { pullDaily } from '@/lib/integrations/google_ads/pull-daily'
import googleAdsAdapter from '@/lib/integrations/google_ads'

/* Helpers ────────────────────────────────────────────────────────────── */

const ORG_ID = 'org_test'
const PROPERTY_ID = 'prop_test'

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  const credentials = encryptCredentials(
    {
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-abc',
      // Far in the future so refresh isn't required by default.
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    },
    ORG_ID,
  )
  return {
    id: 'google_ads',
    provider: 'google_ads',
    propertyId: PROPERTY_ID,
    orgId: ORG_ID,
    authKind: 'oauth2',
    status: 'connected',
    credentialsEnc: credentials,
    meta: {},
    scope: [...GOOGLE_ADS_SCOPES],
    lastPulledAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    backfilledThrough: null,
    createdAt: null,
    updatedAt: null,
    createdBy: 'system',
    createdByType: 'system',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeFetchMock(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(url), init),
  )
  global.fetch = fn as unknown as typeof fetch
  return fn
}

/* schema.ts ─────────────────────────────────────────────────────────── */

describe('schema.ts', () => {
  it('GAQL fields list is the exact contract', () => {
    expect([...GOOGLE_ADS_DAILY_GAQL_FIELDS]).toEqual([
      'segments.date',
      'metrics.cost_micros',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.ctr',
      'metrics.average_cpc',
      'metrics.conversions',
      'metrics.conversions_value',
    ])
  })

  it('builds the daily GAQL string with the expected shape', () => {
    expect(buildDailyGaql('2026-04-25')).toBe(
      "SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date = '2026-04-25'",
    )
  })

  it('normalises currency codes — passes through known ones, defaults to USD', () => {
    expect(normalizeCurrency('USD')).toBe('USD')
    expect(normalizeCurrency('zar')).toBe('ZAR')
    expect(normalizeCurrency('eur')).toBe('EUR')
    expect(normalizeCurrency('XYZ')).toBe('USD') // unknown
    expect(normalizeCurrency(undefined)).toBe('USD')
    expect(normalizeCurrency('')).toBe('USD')
  })
})

/* oauth.ts ──────────────────────────────────────────────────────────── */

describe('oauth.ts', () => {
  const PREV_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...PREV_ENV }
    jest.restoreAllMocks()
  })

  describe('beginOAuth', () => {
    it('returns an empty URL when GOOGLE_OAUTH_CLIENT_ID/SECRET are missing', async () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
      const out = await beginOAuth({
        propertyId: PROPERTY_ID,
        orgId: ORG_ID,
        redirectUri: 'https://app/callback',
        state: 's',
      })
      expect(out.authorizeUrl).toBe('')
    })

    it('builds a Google authorize URL with adwords scope, offline access, and consent prompt', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client.example.com'
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret123'
      const { authorizeUrl } = await beginOAuth({
        propertyId: PROPERTY_ID,
        orgId: ORG_ID,
        redirectUri: 'https://app/callback',
        state: 'state-token',
      })
      expect(authorizeUrl.startsWith(GOOGLE_AUTHORIZE_ENDPOINT)).toBe(true)
      const url = new URL(authorizeUrl)
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('client_id')).toBe('client.example.com')
      expect(url.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/adwords',
      )
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('prompt')).toBe('consent')
      expect(url.searchParams.get('state')).toBe('state-token')
    })
  })

  describe('readDeveloperToken / readLoginCustomerId', () => {
    it('returns null when GOOGLE_ADS_DEVELOPER_TOKEN is unset', () => {
      delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
      expect(readDeveloperToken()).toBeNull()
    })

    it('returns the trimmed developer token when set', () => {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = '  dev-tok-xyz  '
      expect(readDeveloperToken()).toBe('dev-tok-xyz')
    })

    it('strips dashes from GOOGLE_ADS_LOGIN_CUSTOMER_ID', () => {
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '123-456-7890'
      expect(readLoginCustomerId()).toBe('1234567890')
    })

    it('returns null when GOOGLE_ADS_LOGIN_CUSTOMER_ID is unset', () => {
      delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      expect(readLoginCustomerId()).toBeNull()
    })
  })

  describe('stripCustomerIdDashes', () => {
    it('strips dashes from a XXX-XXX-XXXX-formatted id', () => {
      expect(stripCustomerIdDashes('123-456-7890')).toBe('1234567890')
    })

    it('handles already-stripped ids', () => {
      expect(stripCustomerIdDashes('1234567890')).toBe('1234567890')
    })

    it('returns "" for empty / null input', () => {
      expect(stripCustomerIdDashes('')).toBe('')
      expect(stripCustomerIdDashes(null)).toBe('')
      expect(stripCustomerIdDashes(undefined)).toBe('')
    })
  })

  describe('exchangeCodeForTokens', () => {
    it('POSTs to the token endpoint and returns the JSON body on 200', async () => {
      const fetchMock = makeFetchMock(async (url, init) => {
        expect(url).toBe('https://oauth2.googleapis.com/token')
        expect(init.method).toBe('POST')
        const body = String(init.body)
        expect(body).toContain('grant_type=authorization_code')
        expect(body).toContain('code=auth-code')
        return jsonResponse({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      })
      const tokens = await exchangeCodeForTokens({
        code: 'auth-code',
        redirectUri: 'https://x/cb',
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(tokens?.access_token).toBe('a')
      expect(tokens?.refresh_token).toBe('r')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns null on a non-2xx response', async () => {
      makeFetchMock(async () => jsonResponse({ error: 'invalid_grant' }, { status: 400 }))
      const tokens = await exchangeCodeForTokens({
        code: 'bad',
        redirectUri: 'https://x/cb',
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(tokens).toBeNull()
    })
  })

  describe('refreshAccessToken', () => {
    it('POSTs grant_type=refresh_token and returns new tokens', async () => {
      const fetchMock = makeFetchMock(async (_url, init) => {
        const body = String(init.body)
        expect(body).toContain('grant_type=refresh_token')
        expect(body).toContain('refresh_token=rt')
        return jsonResponse({
          access_token: 'new-access',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      })
      const tokens = await refreshAccessToken({
        refreshToken: 'rt',
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(tokens?.access_token).toBe('new-access')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns null on non-2xx', async () => {
      makeFetchMock(async () => jsonResponse({ error: 'invalid_grant' }, { status: 400 }))
      const tokens = await refreshAccessToken({
        refreshToken: 'rt',
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(tokens).toBeNull()
    })
  })
})

/* client.ts ─────────────────────────────────────────────────────────── */

describe('client.ts', () => {
  const PREV_ENV = { ...process.env }
  afterEach(() => {
    process.env = { ...PREV_ENV }
    jest.restoreAllMocks()
  })

  it('searchStream sends developer-token, bearer auth, and login-customer-id headers', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    const fetchMock = makeFetchMock(async (url, init) => {
      expect(url).toBe(
        'https://googleads.googleapis.com/v21/customers/1234567890/googleAds:searchStream',
      )
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer at-1')
      expect(headers['developer-token']).toBe('dev-tok')
      expect(headers['login-customer-id']).toBe('9999999999')
      expect(JSON.parse(String(init.body))).toEqual({
        query: 'SELECT segments.date FROM customer',
      })
      return jsonResponse([
        {
          results: [
            { segments: { date: '2026-04-25' }, metrics: { costMicros: '1000000' } },
          ],
        },
      ])
    })

    const client = createGoogleAdsClient({
      accessToken: 'at-1',
      loginCustomerId: '9999999999',
    })
    const { rows } = await client.searchStream({
      customerId: '1234567890',
      query: 'SELECT segments.date FROM customer',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].segments?.date).toBe('2026-04-25')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('searchStream throws GoogleAdsApiError on 4xx with the parsed payload', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    makeFetchMock(async () =>
      jsonResponse(
        { error: { code: 400, message: 'AUTHENTICATION_ERROR', status: 'UNAUTHENTICATED' } },
        { status: 400 },
      ),
    )
    const client = createGoogleAdsClient({ accessToken: 'at' })
    await expect(
      client.searchStream({ customerId: '1234567890', query: 'SELECT x FROM y' }),
    ).rejects.toMatchObject({
      name: 'GoogleAdsApiError',
      status: 400,
    })
  })

  it('searchStream surfaces error chunks inside a 200 response', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    makeFetchMock(async () =>
      jsonResponse([
        { error: { code: 7, message: 'Permission denied', status: 'PERMISSION_DENIED' } },
      ]),
    )
    const client = createGoogleAdsClient({ accessToken: 'at' })
    await expect(
      client.searchStream({ customerId: '1234567890', query: 'SELECT x FROM y' }),
    ).rejects.toBeInstanceOf(GoogleAdsApiError)
  })

  it('getCustomerSettings returns the customer block from the response', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    makeFetchMock(async () =>
      jsonResponse([
        {
          results: [
            {
              customer: {
                resourceName: 'customers/1234567890',
                currencyCode: 'EUR',
                timeZone: 'Europe/Amsterdam',
              },
            },
          ],
        },
      ]),
    )
    const client = createGoogleAdsClient({ accessToken: 'at' })
    const settings = await client.getCustomerSettings({ customerId: '1234567890' })
    expect(settings).toEqual({
      resourceName: 'customers/1234567890',
      currencyCode: 'EUR',
      timeZone: 'Europe/Amsterdam',
    })
  })

  it('searchStream rejects when customerId is empty', async () => {
    const client = createGoogleAdsClient({ accessToken: 'at' })
    await expect(client.searchStream({ customerId: '', query: 'q' })).rejects.toBeInstanceOf(
      GoogleAdsApiError,
    )
  })
})

/* pull-daily.ts ─────────────────────────────────────────────────────── */

describe('pullDaily', () => {
  const PREV_ENV = { ...process.env }

  beforeEach(() => {
    process.env = { ...PREV_ENV }
  })

  it('returns metricsWritten=0 with notes when GOOGLE_ADS_DEVELOPER_TOKEN is missing', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const writeMetrics = jest.fn(async () => ({ written: 0 }))
    const result = await pullDaily({
      connection: makeConnection(),
      writeMetrics,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      saveMeta: async () => undefined,
      refresh: async () => null,
      createClient: () => {
        throw new Error('client should not be built when dev token is missing')
      },
    })
    expect(result.metricsWritten).toBe(0)
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('GOOGLE_ADS_DEVELOPER_TOKEN missing'),
      ]),
    )
    expect(writeMetrics).not.toHaveBeenCalled()
  })

  it('returns metricsWritten=0 with notes when googleAdsCustomerId is missing', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    const writeMetrics = jest.fn(async () => ({ written: 0 }))
    const result = await pullDaily({
      connection: makeConnection(),
      writeMetrics,
      loadProperty: async () => ({
        googleAdsCustomerId: '',
        timezone: 'UTC',
        currency: 'USD',
      }),
      saveMeta: async () => undefined,
      refresh: async () => null,
      createClient: () => {
        throw new Error('client should not be built without a customer id')
      },
    })
    expect(result.metricsWritten).toBe(0)
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('googleAdsCustomerId missing'),
      ]),
    )
    expect(writeMetrics).not.toHaveBeenCalled()
  })

  it('returns metricsWritten=0 with notes when the connection has no credentials', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'
    const result = await pullDaily({
      connection: makeConnection({ credentialsEnc: null }),
      writeMetrics: async () => ({ written: 0 }),
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      saveMeta: async () => undefined,
      refresh: async () => null,
      createClient: () => {
        throw new Error('client should not be built when no credentials are present')
      },
    })
    expect(result.metricsWritten).toBe(0)
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/No credentials/)]),
    )
  })

  it('writes ad_spend / impressions / clicks / ctr / cpc / conversions / roas for one day', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const writeMetrics = jest.fn(async () => ({ written: 7 }))

    const fakeClient = {
      async searchStream() {
        return {
          chunks: [],
          rows: [
            {
              segments: { date: '2026-04-25' },
              metrics: {
                costMicros: '5000000', // 5.00 USD
                impressions: '1000',
                clicks: '50',
                ctr: '0.05',
                averageCpc: '100000', // 0.10 USD
                conversions: '4',
                conversionsValue: '20',
              },
            },
          ],
        }
      },
      async getCustomerSettings() {
        return { currencyCode: 'USD', timeZone: 'UTC' }
      },
      async request() {
        return undefined as unknown
      },
    } as unknown as ReturnType<typeof createGoogleAdsClient>

    const saveMeta = jest.fn(async () => undefined)

    const result = await pullDaily({
      connection: makeConnection(),
      window: { from: '2026-04-25', to: '2026-04-25' },
      writeMetrics,
      saveMeta,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      refresh: async () => null,
      createClient: () => fakeClient,
    })

    expect(result).toEqual(
      expect.objectContaining({
        from: '2026-04-25',
        to: '2026-04-25',
        metricsWritten: 7,
      }),
    )

    expect(writeMetrics).toHaveBeenCalledTimes(1)
    const calls = writeMetrics.mock.calls as unknown as Array<[
      Array<{ metric: string; value: number; currency: string | null }>,
    ]>
    const rows = calls[0]?.[0] ?? []

    // 7 metrics = ad_spend + impressions + clicks + ctr + cpc + conversions + roas
    expect(rows).toHaveLength(7)
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]))
    expect(byMetric.ad_spend.value).toBeCloseTo(5)
    expect(byMetric.ad_spend.currency).toBe('USD')
    expect(byMetric.impressions.value).toBe(1000)
    expect(byMetric.impressions.currency).toBeNull()
    expect(byMetric.clicks.value).toBe(50)
    expect(byMetric.ctr.value).toBeCloseTo(0.05)
    expect(byMetric.cpc.value).toBeCloseTo(0.1)
    expect(byMetric.cpc.currency).toBe('USD')
    expect(byMetric.conversions.value).toBe(4)
    // ROAS = 20 / 5 = 4
    expect(byMetric.roas.value).toBeCloseTo(4)
    expect(byMetric.roas.currency).toBeNull()
  })

  it('emits zero rows (and skips ROAS) when the day has no spend', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const writeMetrics = jest.fn(async () => ({ written: 6 }))

    const fakeClient = {
      async searchStream() {
        return { chunks: [], rows: [] }
      },
      async getCustomerSettings() {
        return { currencyCode: 'USD', timeZone: 'UTC' }
      },
      async request() {
        return undefined as unknown
      },
    } as unknown as ReturnType<typeof createGoogleAdsClient>

    const result = await pullDaily({
      connection: makeConnection({
        meta: { currencyCode: 'USD' }, // skip getCustomerSettings call
      }),
      window: { from: '2026-04-24', to: '2026-04-24' },
      writeMetrics,
      saveMeta: async () => undefined,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      refresh: async () => null,
      createClient: () => fakeClient,
    })

    expect(result.metricsWritten).toBe(6)
    expect(writeMetrics).toHaveBeenCalledTimes(1)
    const calls = writeMetrics.mock.calls as unknown as Array<[
      Array<{ metric: string; value: number }>,
    ]>
    const rows = calls[0]?.[0] ?? []
    // 6 zero metrics, no ROAS (since cost == 0)
    expect(rows.map((r) => r.metric).sort()).toEqual(
      ['ad_spend', 'clicks', 'conversions', 'cpc', 'ctr', 'impressions'].sort(),
    )
    expect(rows.every((r) => r.value === 0)).toBe(true)
  })

  it('iterates each day in a multi-day backfill window', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const searchStream = jest.fn(async ({ query }: { query: string }) => {
      // Extract the WHERE date from the GAQL string for assertion clarity.
      const match = /segments\.date = '(\d{4}-\d{2}-\d{2})'/.exec(query)
      const date = match?.[1] ?? ''
      return {
        chunks: [],
        rows: [
          {
            segments: { date },
            metrics: {
              costMicros: '1000000',
              impressions: '100',
              clicks: '10',
              ctr: '0.1',
              averageCpc: '100000',
              conversions: '1',
              conversionsValue: '5',
            },
          },
        ],
      }
    })

    const fakeClient = {
      searchStream,
      async getCustomerSettings() {
        return { currencyCode: 'USD', timeZone: 'UTC' }
      },
      async request() {
        return undefined as unknown
      },
    } as unknown as ReturnType<typeof createGoogleAdsClient>

    const writeMetrics = jest.fn(async () => ({ written: 21 })) // 7 metrics * 3 days

    const result = await pullDaily({
      connection: makeConnection({ meta: { currencyCode: 'USD' } }),
      window: { from: '2026-04-23', to: '2026-04-25' },
      writeMetrics,
      saveMeta: async () => undefined,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      refresh: async () => null,
      createClient: () => fakeClient,
    })

    expect(searchStream).toHaveBeenCalledTimes(3)
    const queriedDates = searchStream.mock.calls
      .map((c) => /segments\.date = '(\d{4}-\d{2}-\d{2})'/.exec((c[0] as { query: string }).query)?.[1])
      .filter(Boolean)
    expect(queriedDates).toEqual(['2026-04-23', '2026-04-24', '2026-04-25'])
    expect(result.metricsWritten).toBe(21)
  })

  it('refreshes the access token when expired', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const expiredCreds = encryptCredentials(
      {
        accessToken: 'expired-at',
        refreshToken: 'rt-good',
        expiresAt: Date.now() - 1000, // already expired
      },
      ORG_ID,
    )

    const refresh = jest.fn(async (rt: string) => {
      expect(rt).toBe('rt-good')
      return { access_token: 'fresh-at', expires_in: 3600 }
    })

    const seenAccessTokens: string[] = []
    const fakeClientFactory = ({ accessToken }: { accessToken: string }) => {
      seenAccessTokens.push(accessToken)
      return {
        async searchStream() {
          return { chunks: [], rows: [] }
        },
        async getCustomerSettings() {
          return { currencyCode: 'USD' }
        },
        async request() {
          return undefined as unknown
        },
      } as unknown as ReturnType<typeof createGoogleAdsClient>
    }

    const writeMetrics = jest.fn(async () => ({ written: 6 }))
    const saveMeta = jest.fn(async () => undefined)

    await pullDaily({
      connection: makeConnection({
        credentialsEnc: expiredCreds,
        meta: { currencyCode: 'USD' },
      }),
      window: { from: '2026-04-25', to: '2026-04-25' },
      writeMetrics,
      saveMeta,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      refresh,
      createClient: fakeClientFactory,
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(seenAccessTokens).toEqual(['fresh-at'])
    // Refreshed credentials should have been persisted.
    expect(saveMeta).toHaveBeenCalled()
  })

  it('returns notes and skips writing when refresh fails on an expired token', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const expiredCreds = encryptCredentials(
      {
        accessToken: 'expired-at',
        refreshToken: 'rt-bad',
        expiresAt: Date.now() - 1000,
      },
      ORG_ID,
    )

    const writeMetrics = jest.fn(async () => ({ written: 0 }))

    const result = await pullDaily({
      connection: makeConnection({ credentialsEnc: expiredCreds }),
      writeMetrics,
      saveMeta: async () => undefined,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: 'USD',
      }),
      refresh: async () => null,
      createClient: () => {
        throw new Error('client should not be built when refresh fails')
      },
    })

    expect(result.metricsWritten).toBe(0)
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('refresh_failed')]),
    )
    expect(writeMetrics).not.toHaveBeenCalled()
  })

  it('uses USD when neither connection.meta.currencyCode nor property currency are known', async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-tok'

    const fakeClient = {
      async searchStream() {
        return {
          chunks: [],
          rows: [
            {
              segments: { date: '2026-04-25' },
              metrics: { costMicros: '1000000' },
            },
          ],
        }
      },
      async getCustomerSettings() {
        return null
      },
      async request() {
        return undefined as unknown
      },
    } as unknown as ReturnType<typeof createGoogleAdsClient>

    const writeMetrics = jest.fn(async () => ({ written: 6 }))

    await pullDaily({
      connection: makeConnection(),
      window: { from: '2026-04-25', to: '2026-04-25' },
      writeMetrics,
      saveMeta: async () => undefined,
      loadProperty: async () => ({
        googleAdsCustomerId: '123-456-7890',
        timezone: 'UTC',
        currency: undefined,
      }),
      refresh: async () => null,
      createClient: () => fakeClient,
    })

    const calls = writeMetrics.mock.calls as unknown as Array<[
      Array<{ metric: string; currency: string | null }>,
    ]>
    const rows = calls[0]?.[0] ?? []
    const adSpend = rows.find((r) => r.metric === 'ad_spend')
    expect(adSpend?.currency).toBe('USD')
  })
})

/* index.ts ──────────────────────────────────────────────────────────── */

describe('adapter (default export)', () => {
  it('exposes the IntegrationAdapter contract', () => {
    expect(googleAdsAdapter.provider).toBe('google_ads')
    expect(googleAdsAdapter.authKind).toBe('oauth2')
    expect(googleAdsAdapter.display.name).toBe('Google Ads')
    expect(typeof googleAdsAdapter.beginOAuth).toBe('function')
    expect(typeof googleAdsAdapter.completeOAuth).toBe('function')
    expect(typeof googleAdsAdapter.pullDaily).toBe('function')
    expect(typeof googleAdsAdapter.revoke).toBe('function')
  })

  it('revoke is a no-op when the connection has no credentials', async () => {
    await expect(
      googleAdsAdapter.revoke!({ connection: makeConnection({ credentialsEnc: null }) }),
    ).resolves.toBeUndefined()
  })
})
