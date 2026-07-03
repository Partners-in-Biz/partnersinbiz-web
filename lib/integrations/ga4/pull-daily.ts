// lib/integrations/ga4/pull-daily.ts
//
// Daily pull for GA4: pulls yesterday's web/app analytics from the
// `properties/{id}:runReport` endpoint and writes them through writeMetrics.
//
// Two reports are issued per pull:
//   1. Date-only — daily totals for sessions / pageviews / users / new_users
//      / engaged_sessions / bounce_rate / avg_session_duration / conversions.
//   2. (optional v1) source/medium breakdown — a `conversions` row per
//      sessionSourceMedium, capped to top 10 to limit row count.
//
// The adapter NEVER throws on missing credentials, missing config, or any
// expected 4xx from GA4 (auth, permissions, property-not-found). In those
// cases it returns `{ metricsWritten: 0, notes: [...] }` so the dispatcher
// can record a soft skip.

import { adminDb } from '@/lib/firebase/admin'
import { writeMetrics } from '@/lib/metrics/write'
import type { Connection, PullResult } from '@/lib/integrations/types'
import { maybeDecryptCredentials } from '@/lib/integrations/crypto'
import type { Property } from '@/lib/properties/types'
import type { MetricInput, MetricKind } from '@/lib/metrics/types'
import {
  createGa4Client,
  Ga4ApiError,
  type Ga4Client,
} from './client'
import type {
  Ga4Credentials,
  Ga4MetricName,
  Ga4Row,
  Ga4RunReportResponse,
} from './schema'
import { GA4_METRICS_ORDER } from './schema'
import { readEnv } from './oauth'

/** Map the GA4 metric column name → our internal MetricKind. */
const GA4_METRIC_TO_KIND: Record<Ga4MetricName, MetricKind> = {
  sessions: 'sessions',
  screenPageViews: 'pageviews',
  totalUsers: 'users',
  newUsers: 'new_users',
  engagedSessions: 'engaged_sessions',
  bounceRate: 'bounce_rate',
  averageSessionDuration: 'avg_session_duration',
  conversions: 'conversions',
}

/** Number of source/medium rows we accept. */
const SOURCE_MEDIUM_TOP_N = 10

/** Lazily fetched property — cached per call. */
async function getPropertyForConnection(connection: Connection): Promise<Property | null> {
  try {
    const snap = await adminDb
      .collection('properties')
      .doc(connection.propertyId)
      .get()
    if (!snap.exists) return null
    return { id: snap.id, ...(snap.data() as Omit<Property, 'id'>) }
  } catch {
    return null
  }
}

/**
 * Compute the YYYY-MM-DD that represents "yesterday" relative to now in the
 * given IANA timezone. Falls back to UTC if the tz string is invalid.
 *
 * GA4 reports daily metrics in the property's configured timezone, so we
 * mirror that here for our date buckets.
 */
export function yesterdayInTimezone(now: Date, timezone?: string): string {
  const tz = timezone && timezone.length > 0 ? timezone : 'UTC'
  let todayStr: string
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    todayStr = fmt.format(now) // 'YYYY-MM-DD'
  } catch {
    todayStr = now.toISOString().slice(0, 10)
  }
  const [y, m, d] = todayStr.split('-').map((s) => parseInt(s, 10))
  const ms = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Build the date-only runReport request for the daily pull window. */
export function buildDailyReportRequest(input: { from: string; to: string }) {
  return {
    dateRanges: [{ startDate: input.from, endDate: input.to }],
    metrics: GA4_METRICS_ORDER.map((name) => ({ name })),
    dimensions: [{ name: 'date' }],
  }
}

/** Build the source/medium breakdown request, conversions only, top-N. */
export function buildSourceMediumReportRequest(input: { from: string; to: string }) {
  return {
    dateRanges: [{ startDate: input.from, endDate: input.to }],
    metrics: [{ name: 'conversions' }, { name: 'sessions' }],
    dimensions: [{ name: 'sessionSourceMedium' }],
    orderBys: [{ metric: { metricName: 'conversions' }, desc: true }],
    limit: String(SOURCE_MEDIUM_TOP_N),
  }
}

/** Convert GA4's 'YYYYMMDD' back to 'YYYY-MM-DD'. Returns input on mismatch. */
function ga4DateToIso(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return null
}

/** Find the index of a metric column by its GA4 name in the response header. */
function metricIndex(
  response: Ga4RunReportResponse,
  name: string,
): number {
  const headers = response.metricHeaders ?? []
  return headers.findIndex((h) => h.name === name)
}

/** Parse a row into a number for the metric at the given index. */
function rowMetricNumber(row: Ga4Row, idx: number): number {
  if (idx < 0) return NaN
  const raw = row.metricValues?.[idx]?.value
  if (raw == null) return NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

/** Parse a row dimension value at index. */
function rowDimensionValue(row: Ga4Row, idx: number): string | null {
  if (idx < 0) return null
  return row.dimensionValues?.[idx]?.value ?? null
}

interface PullDailyDeps {
  /** Override for tests — ignored in prod. */
  client?: Ga4Client
  /** Stable "now" for tests. */
  now?: Date
  /** Toggle the source/medium second call. Defaults to true. */
  includeSourceMedium?: boolean
  /**
   * Metric `source` tag written to each row. Defaults to `'ga4'`. The
   * Firebase Analytics adapter (lib/integrations/firebase_analytics) passes
   * `'firebase_analytics'` here so rows are attributed correctly even though
   * they're pulled via the same GA4 Data API — Firebase Analytics data for
   * an app is served through GA4's Data API using the Firebase-linked GA4
   * property id, there is no separate Firebase reporting API.
   */
  source?: 'ga4' | 'firebase_analytics'
  /**
   * Property-id resolution override, in priority order, tried before the
   * standard `connection.meta.ga4PropertyId` / `Property.config.revenue.ga4PropertyId`
   * chain. Used by the Firebase Analytics adapter to prefer a
   * `firebaseAnalyticsPropertyId` field while still falling back to the
   * shared `ga4PropertyId` field (same GA4 property, just Firebase-linked).
   */
  resolvePropertyId?: (input: { connection: Connection; property: Property | null }) => string | undefined
  /** Error/empty-state copy uses this label instead of "GA4". */
  providerLabel?: string
}

/**
 * Pull daily GA4 metrics for a connection. Returns a PullResult with the
 * number of metric rows written. Soft-fails (returns 0 written) for any
 * recoverable error (missing creds / property id / 4xx from Google).
 */
export async function pullDaily(
  input: { connection: Connection; window?: { from: string; to: string } },
  deps: PullDailyDeps = {},
): Promise<PullResult> {
  const { connection } = input
  const now = deps.now ?? new Date()
  const source = deps.source ?? 'ga4'
  const providerLabel = deps.providerLabel ?? 'GA4'

  // 1. Decrypt credentials (soft-fail if missing).
  const creds = maybeDecryptCredentials<Ga4Credentials>(
    connection.credentialsEnc,
    connection.orgId,
  )
  if (!creds || !creds.accessToken) {
    return {
      from: '',
      to: '',
      metricsWritten: 0,
      notes: [`No ${providerLabel} credentials on connection — skipping pull.`],
    }
  }

  // 2. Resolve GA4 property id. Default chain:
  //    connection.meta.ga4PropertyId > Property.config.revenue.ga4PropertyId.
  //    `deps.resolvePropertyId` (if provided) is tried first.
  const property = await getPropertyForConnection(connection)
  const revCfg = property?.config?.revenue ?? {}
  const ga4PropertyId =
    deps.resolvePropertyId?.({ connection, property }) ??
    (connection.meta?.ga4PropertyId as string | undefined) ??
    revCfg.ga4PropertyId

  if (!ga4PropertyId) {
    return {
      from: '',
      to: '',
      metricsWritten: 0,
      notes: [
        `No ${providerLabel} propertyId resolved (set Property.config.revenue.ga4PropertyId).`,
      ],
    }
  }

  // 3. Window resolution: window override > yesterday-in-property-tz.
  const yesterday = yesterdayInTimezone(now, revCfg.timezone)
  const from = input.window?.from ?? yesterday
  const to = input.window?.to ?? yesterday

  // 4. Build the client (deps.client wins for tests).
  let client = deps.client
  if (!client) {
    const env = readEnv()
    client = createGa4Client({
      credentials: creds,
      oauth: env ?? undefined,
    })
  }

  // 5. Hit the date-only daily report. Soft-fail on 4xx; throw on 5xx.
  let dailyReport: Ga4RunReportResponse
  try {
    dailyReport = await client.runReport({
      ga4PropertyId,
      request: buildDailyReportRequest({ from, to }),
    })
  } catch (err) {
    if (err instanceof Ga4ApiError && err.status >= 400 && err.status < 500) {
      return {
        from,
        to,
        metricsWritten: 0,
        notes: [
          `${providerLabel} returned ${err.status} on properties/${ga4PropertyId}:runReport — check OAuth scope and property id.`,
        ],
      }
    }
    throw err
  }

  // 6. Map the date-grain rows to metrics.
  const dateIdx = (dailyReport.dimensionHeaders ?? []).findIndex(
    (h) => h.name === 'date',
  )
  const rows: MetricInput[] = []

  for (const row of dailyReport.rows ?? []) {
    const dateRaw = rowDimensionValue(row, dateIdx)
    const isoDate = ga4DateToIso(dateRaw)
    if (!isoDate) continue

    for (const ga4Name of GA4_METRICS_ORDER) {
      const idx = metricIndex(dailyReport, ga4Name)
      const value = rowMetricNumber(row, idx)
      if (!Number.isFinite(value)) continue
      const kind = GA4_METRIC_TO_KIND[ga4Name]
      rows.push({
        orgId: connection.orgId,
        propertyId: connection.propertyId,
        date: isoDate,
        source,
        metric: kind,
        value,
        currency: null,
        dimension: null,
        dimensionValue: null,
        raw: { provider: source, ga4Name, ga4PropertyId },
      })
    }
  }

  // 7. (optional v1) source/medium breakdown — capped to top 10.
  const includeSourceMedium = deps.includeSourceMedium ?? true
  const notes: string[] = []
  if (includeSourceMedium) {
    try {
      const breakdown = await client.runReport({
        ga4PropertyId,
        request: buildSourceMediumReportRequest({ from, to }),
      })
      const sourceIdx = (breakdown.dimensionHeaders ?? []).findIndex(
        (h) => h.name === 'sessionSourceMedium',
      )
      const conversionsIdx = metricIndex(breakdown, 'conversions')
      for (const row of breakdown.rows ?? []) {
        const dimValue = rowDimensionValue(row, sourceIdx)
        const value = rowMetricNumber(row, conversionsIdx)
        if (!dimValue || !Number.isFinite(value)) continue
        rows.push({
          orgId: connection.orgId,
          propertyId: connection.propertyId,
          date: to,
          source,
          metric: 'conversions',
          value,
          currency: null,
          dimension: 'source_medium',
          dimensionValue: dimValue,
          raw: { provider: source, ga4Name: 'conversions', ga4PropertyId },
        })
      }
    } catch (err) {
      // Soft-fail on the secondary call — main daily totals already captured.
      const msg = err instanceof Ga4ApiError
        ? `${providerLabel} returned ${err.status} on source/medium breakdown.`
        : `${providerLabel} source/medium breakdown failed.`
      notes.push(msg)
    }
  }

  // 8. Sampling / freshness notes from the daily report metadata.
  const sampling = dailyReport.metadata?.samplingMetadatas ?? []
  if (sampling.length > 0) {
    notes.push(
      `${providerLabel} returned a sampled report — values are estimates. Reduce date range or use Analytics 360 to remove sampling.`,
    )
  }

  if (rows.length === 0) {
    return {
      from,
      to,
      metricsWritten: 0,
      notes: notes.length > 0
        ? notes
        : [`${providerLabel} :runReport returned no rows for this window.`],
    }
  }

  const { written } = await writeMetrics(rows, { ingestedBy: 'cron' })
  return {
    from,
    to,
    metricsWritten: written,
    ...(notes.length > 0 ? { notes } : {}),
  }
}
