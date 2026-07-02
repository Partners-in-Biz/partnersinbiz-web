// 64-char hex master key for tests (matches the production format)
process.env.SOCIAL_TOKEN_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// ----- Mocks ---------------------------------------------------------------
// Same seams as the GA4 adapter test — Firebase Analytics delegates to the
// GA4 Data API client and pull-daily logic, so it touches the exact same
// external boundaries:
//   * lib/metrics/write       — writes the metric rows
//   * lib/integrations/connections — upsert/setStatus during OAuth/revoke
//   * lib/firebase/admin      — adminDb.collection('properties').doc(...).get()

jest.mock('@/lib/metrics/write', () => ({
  __esModule: true,
  writeMetrics: jest.fn(async (rows: unknown[]) => ({ written: rows.length })),
  metricDocId: jest.fn(() => 'doc_id'),
  deleteMetric: jest.fn(),
  METRICS_COLLECTION: 'metrics',
}))

jest.mock('@/lib/integrations/connections', () => ({
  __esModule: true,
  getConnection: jest.fn(),
  upsertConnection: jest.fn(async (input: Record<string, unknown>) => ({
    id: 'firebase_analytics',
    ...input,
  })),
  markPullSuccess: jest.fn(),
  markPullFailure: jest.fn(),
  setConnectionStatus: jest.fn(),
  deleteConnection: jest.fn(),
  listConnectionsForProperty: jest.fn(),
  listConnectionsForOrg: jest.fn(),
  listDueConnections: jest.fn(),
}))

// adminDb is read by pull-daily (via the GA4 pull-daily it delegates to) to
// look up the property. Default: not found.
const propertySnap: { exists: boolean; data: () => unknown } = {
  exists: false,
  data: () => undefined,
}

jest.mock('@/lib/firebase/admin', () => ({
  __esModule: true,
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => propertySnap),
      })),
    })),
  },
}))

import {
  pullDaily,
} from '@/lib/integrations/firebase_analytics/pull-daily'
import {
  beginOAuth,
  completeOAuth,
  FIREBASE_ANALYTICS_SCOPES,
} from '@/lib/integrations/firebase_analytics/oauth'
import { GOOGLE_AUTHORIZE_ENDPOINT, GA4_SCOPES } from '@/lib/integrations/ga4/oauth'
import { GA4_METRICS_ORDER } from '@/lib/integrations/ga4/schema'
import { Ga4ApiError } from '@/lib/integrations/ga4/client'
import firebaseAnalyticsAdapter from '@/lib/integrations/firebase_analytics'
import { encryptCredentials } from '@/lib/integrations/crypto'
import { writeMetrics } from '@/lib/metrics/write'
import { upsertConnection } from '@/lib/integrations/connections'
import type { Connection } from '@/lib/integrations/types'

const writeMetricsMock = writeMetrics as jest.MockedFunction<typeof writeMetrics>
const upsertConnectionMock = upsertConnection as jest.MockedFunction<typeof upsertConnection>

// ----- Helpers -------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  const credentialsEnc = encryptCredentials(
    { accessToken: 'at_test', refreshToken: 'rt_test', expiresAt: Date.now() + 60_000 },
    'org_test',
  )
  return {
    id: 'firebase_analytics',
    provider: 'firebase_analytics',
    propertyId: 'prop_1',
    orgId: 'org_test',
    authKind: 'oauth2',
    status: 'connected',
    credentialsEnc,
    meta: { firebaseAnalyticsPropertyId: '555000111' },
    scope: [...FIREBASE_ANALYTICS_SCOPES],
    lastPulledAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    backfilledThrough: null,
    createdAt: null,
    updatedAt: null,
    createdBy: 'admin',
    createdByType: 'user',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** Build a synthetic GA4 :runReport response from a metric-name → value map. */
function makeDailyReport(date: string, metricValues: Record<string, number>) {
  const headers = GA4_METRICS_ORDER.map((name) => ({ name }))
  const cells = GA4_METRICS_ORDER.map((name) => ({
    value: String(metricValues[name] ?? 0),
  }))
  return {
    dimensionHeaders: [{ name: 'date' }],
    metricHeaders: headers,
    rows: [
      {
        dimensionValues: [{ value: date.replace(/-/g, '') }],
        metricValues: cells,
      },
    ],
    rowCount: 1,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  writeMetricsMock.mockImplementation(async (rows) => ({ written: rows.length }))
  propertySnap.exists = false
  propertySnap.data = () => undefined
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid_test'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret_test'
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ============================================================================
// Adapter shape
// ============================================================================

describe('Firebase Analytics adapter shape', () => {
  it('declares provider, authKind, and required hooks', () => {
    expect(firebaseAnalyticsAdapter.provider).toBe('firebase_analytics')
    expect(firebaseAnalyticsAdapter.authKind).toBe('oauth2')
    expect(typeof firebaseAnalyticsAdapter.pullDaily).toBe('function')
    expect(typeof firebaseAnalyticsAdapter.beginOAuth).toBe('function')
    expect(typeof firebaseAnalyticsAdapter.completeOAuth).toBe('function')
    expect(typeof firebaseAnalyticsAdapter.revoke).toBe('function')
    expect(firebaseAnalyticsAdapter.display.name).toBe('Firebase Analytics')
  })

  it('does NOT expose saveCredentials (reuses GA4 OAuth, not a credential-based auth)', () => {
    expect(firebaseAnalyticsAdapter.saveCredentials).toBeUndefined()
  })

  it('reuses the exact GA4 analytics.readonly OAuth scope', () => {
    expect(FIREBASE_ANALYTICS_SCOPES).toEqual(GA4_SCOPES)
    expect(FIREBASE_ANALYTICS_SCOPES).toEqual([
      'https://www.googleapis.com/auth/analytics.readonly',
    ])
  })
})

// ============================================================================
// OAuth: beginOAuth (delegates to GA4's beginOAuth)
// ============================================================================

describe('beginOAuth', () => {
  it('returns an authorize URL with the expected params (same as GA4)', async () => {
    const out = await beginOAuth({
      propertyId: 'prop_1',
      orgId: 'org_test',
      redirectUri: 'https://app.example.com/callback',
      state: 'state_xyz',
    })
    expect(out.authorizeUrl.startsWith(GOOGLE_AUTHORIZE_ENDPOINT)).toBe(true)
    const url = new URL(out.authorizeUrl)
    expect(url.searchParams.get('client_id')).toBe('cid_test')
    expect(url.searchParams.get('scope')).toBe(FIREBASE_ANALYTICS_SCOPES.join(' '))
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  it('returns an empty authorize URL when env vars are missing', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const out = await beginOAuth({
      propertyId: 'prop_1',
      orgId: 'org_test',
      redirectUri: 'https://app.example.com/callback',
      state: 's',
    })
    expect(out.authorizeUrl).toBe('')
  })
})

// ============================================================================
// OAuth: completeOAuth — persists under provider 'firebase_analytics'
// ============================================================================

describe('completeOAuth', () => {
  it('persists tokens under provider firebase_analytics after a successful exchange', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    )

    const out = await completeOAuth({
      propertyId: 'prop_1',
      orgId: 'org_test',
      code: 'authcode',
      redirectUri: 'https://app.example.com/callback',
    })

    expect(upsertConnectionMock).toHaveBeenCalledTimes(1)
    const arg = upsertConnectionMock.mock.calls[0][0]
    expect(arg.provider).toBe('firebase_analytics')
    expect(arg.authKind).toBe('oauth2')
    expect(arg.status).toBe('connected')
    expect(arg.credentials).toMatchObject({
      accessToken: 'at_new',
      refreshToken: 'rt_new',
    })
    expect(arg.scope).toContain('https://www.googleapis.com/auth/analytics.readonly')
    expect(out.id).toBe('firebase_analytics')
  })

  it('records error status when env vars are missing', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    await completeOAuth({
      propertyId: 'prop_1',
      orgId: 'org_test',
      code: 'authcode',
      redirectUri: 'https://app.example.com/callback',
    })
    const arg = upsertConnectionMock.mock.calls[0][0]
    expect(arg.provider).toBe('firebase_analytics')
    expect(arg.status).toBe('error')
    expect(arg.meta).toMatchObject({ error: expect.stringMatching(/CLIENT_ID/i) })
  })

  it('records error status when token exchange fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('bad code', { status: 400 }),
    )
    await completeOAuth({
      propertyId: 'prop_1',
      orgId: 'org_test',
      code: 'authcode',
      redirectUri: 'https://app.example.com/callback',
    })
    const arg = upsertConnectionMock.mock.calls[0][0]
    expect(arg.status).toBe('error')
    expect(arg.meta).toMatchObject({ error: 'token_exchange_failed' })
  })
})

// ============================================================================
// pullDaily — delegates to the GA4 Data API client with source override
// ============================================================================

describe('pullDaily', () => {
  it('returns 0 written and a Firebase-Analytics-labelled note when there are no credentials', async () => {
    const conn = makeConnection({ credentialsEnc: null })
    const result = await pullDaily({ connection: conn })
    expect(result.metricsWritten).toBe(0)
    expect(result.notes?.[0]).toMatch(/No Firebase Analytics credentials/i)
    expect(writeMetricsMock).not.toHaveBeenCalled()
  })

  it('returns 0 written and a note when no property id can be resolved', async () => {
    const conn = makeConnection({ meta: {} })
    propertySnap.exists = true
    propertySnap.data = () => ({ config: { revenue: {} } })
    const result = await pullDaily({ connection: conn })
    expect(result.metricsWritten).toBe(0)
    expect(result.notes?.[0]).toMatch(/propertyId/i)
    expect(writeMetricsMock).not.toHaveBeenCalled()
  })

  it('prefers connection.meta.firebaseAnalyticsPropertyId over everything else', async () => {
    const conn = makeConnection({ meta: { firebaseAnalyticsPropertyId: '111222333' } })
    const fakeClient = {
      runReport: jest.fn(async () => makeDailyReport('2026-04-25', { sessions: 1 })),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )
    const firstCall = fakeClient.runReport.mock.calls[0] as unknown as [
      { ga4PropertyId: string },
    ]
    expect(firstCall[0].ga4PropertyId).toBe('111222333')
  })

  it('falls back to Property.config.revenue.firebaseAnalyticsPropertyId when meta is empty', async () => {
    const conn = makeConnection({ meta: {} })
    propertySnap.exists = true
    propertySnap.data = () => ({
      config: { revenue: { firebaseAnalyticsPropertyId: '999888777', timezone: 'UTC' } },
    })

    const fakeClient = {
      runReport: jest.fn(async () => makeDailyReport('2026-04-25', { sessions: 1 })),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )
    const firstCall = fakeClient.runReport.mock.calls[0] as unknown as [
      { ga4PropertyId: string },
    ]
    expect(firstCall[0].ga4PropertyId).toBe('999888777')
  })

  it('falls back further to the shared Property.config.revenue.ga4PropertyId when Firebase-specific fields are unset', async () => {
    const conn = makeConnection({ meta: {} })
    propertySnap.exists = true
    propertySnap.data = () => ({
      config: { revenue: { ga4PropertyId: '444555666', timezone: 'UTC' } },
    })

    const fakeClient = {
      runReport: jest.fn(async () => makeDailyReport('2026-04-25', { sessions: 1 })),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )
    const firstCall = fakeClient.runReport.mock.calls[0] as unknown as [
      { ga4PropertyId: string },
    ]
    expect(firstCall[0].ga4PropertyId).toBe('444555666')
  })

  it('writes one metric row per (date, metric) cell, tagged source=firebase_analytics', async () => {
    const conn = makeConnection()
    const fakeClient = {
      runReport: jest.fn(async () =>
        makeDailyReport('2026-04-25', {
          sessions: 640,
          screenPageViews: 2100,
          totalUsers: 300,
          newUsers: 90,
          engagedSessions: 400,
          bounceRate: 0.21,
          averageSessionDuration: 88.2,
          conversions: 12,
        }),
      ),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    const result = await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )

    expect(fakeClient.runReport).toHaveBeenCalledTimes(1)
    const rows = writeMetricsMock.mock.calls[0][0]
    const map = new Map(rows.map((r) => [r.metric, r]))

    expect(map.get('sessions')?.value).toBe(640)
    expect(map.get('pageviews')?.value).toBe(2100)
    expect(map.get('users')?.value).toBe(300)
    expect(map.get('new_users')?.value).toBe(90)
    expect(map.get('engaged_sessions')?.value).toBe(400)
    expect(map.get('bounce_rate')?.value).toBeCloseTo(0.21)
    expect(map.get('avg_session_duration')?.value).toBeCloseTo(88.2)
    expect(map.get('conversions')?.value).toBe(12)

    // Rows are tagged as Firebase Analytics, not GA4 — this is the whole
    // point of a distinct provider despite sharing the fetch logic.
    for (const r of rows) {
      expect(r.source).toBe('firebase_analytics')
      expect(r.currency).toBeNull()
      expect(r.date).toBe('2026-04-25')
      expect((r.raw as { provider?: string } | null)?.provider).toBe('firebase_analytics')
    }

    expect(result.from).toBe('2026-04-25')
    expect(result.to).toBe('2026-04-25')
    expect(result.metricsWritten).toBe(rows.length)
  })

  it('writes per-source_medium conversion rows tagged source=firebase_analytics', async () => {
    const conn = makeConnection()
    const dailyReport = makeDailyReport('2026-04-25', { sessions: 1, conversions: 10 })
    const breakdownReport = {
      dimensionHeaders: [{ name: 'sessionSourceMedium' }],
      metricHeaders: [{ name: 'conversions' }, { name: 'sessions' }],
      rows: [
        {
          dimensionValues: [{ value: 'google / organic' }],
          metricValues: [{ value: '4' }, { value: '80' }],
        },
      ],
    }

    const fakeClient = {
      runReport: jest
        .fn()
        .mockResolvedValueOnce(dailyReport)
        .mockResolvedValueOnce(breakdownReport),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z') },
    )

    expect(fakeClient.runReport).toHaveBeenCalledTimes(2)
    const rows = writeMetricsMock.mock.calls[0][0]
    const sourceMediumRows = rows.filter((r) => r.dimension === 'source_medium')
    expect(sourceMediumRows).toHaveLength(1)
    expect(sourceMediumRows[0].dimensionValue).toBe('google / organic')
    expect(sourceMediumRows[0].source).toBe('firebase_analytics')
  })

  it('soft-fails on GA4 4xx (via the shared Data API) and writes nothing', async () => {
    const conn = makeConnection()
    const fakeClient = {
      runReport: jest.fn(async () => {
        throw new Ga4ApiError(403, 'forbidden', '')
      }),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    const result = await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z') },
    )
    expect(result.metricsWritten).toBe(0)
    expect(result.notes?.[0]).toMatch(/Firebase Analytics returned 403/)
    expect(writeMetricsMock).not.toHaveBeenCalled()
  })

  it('throws on GA4 5xx so the dispatcher records a failure', async () => {
    const conn = makeConnection()
    const fakeClient = {
      runReport: jest.fn(async () => {
        throw new Ga4ApiError(500, 'oops', '')
      }),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }
    await expect(
      pullDaily({ connection: conn }, { client: fakeClient }),
    ).rejects.toMatchObject({ status: 500 })
  })

  it('respects an explicit window override', async () => {
    const conn = makeConnection()
    const fakeClient = {
      runReport: jest.fn(async () => makeDailyReport('2026-04-01', { sessions: 1 })),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    const result = await pullDaily(
      { connection: conn, window: { from: '2026-04-01', to: '2026-04-01' } },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )
    expect(result.from).toBe('2026-04-01')
    expect(result.to).toBe('2026-04-01')
  })

  it('returns 0 written and a Firebase-Analytics-labelled note when the report has no rows', async () => {
    const conn = makeConnection()
    const fakeClient = {
      runReport: jest.fn(async () => ({
        dimensionHeaders: [{ name: 'date' }],
        metricHeaders: GA4_METRICS_ORDER.map((name) => ({ name })),
        rows: [],
      })),
      getCredentials: jest.fn(() => ({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60_000,
      })),
      request: jest.fn(),
    }

    const result = await pullDaily(
      { connection: conn },
      { client: fakeClient, now: new Date('2026-04-26T05:00:00Z'), includeSourceMedium: false },
    )
    expect(result.metricsWritten).toBe(0)
    expect(result.notes?.[0]).toMatch(/Firebase Analytics :runReport returned no rows/i)
    expect(writeMetricsMock).not.toHaveBeenCalled()
  })
})
