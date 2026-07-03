// lib/integrations/firebase_analytics/pull-daily.ts
//
// Firebase Analytics is NOT a separate reporting API — Firebase Analytics
// data for an app is served through the Google Analytics Data API
// (`analyticsdata.googleapis.com`) using the GA4 property that Firebase
// auto-links when Analytics is enabled on the Firebase project. There is no
// distinct "Firebase Analytics API" to call.
//
// So this adapter is a thin wrapper around `lib/integrations/ga4/pull-daily`:
// same OAuth client, same Data API request/response shapes, same core
// metrics (sessions, screenPageViews, totalUsers, newUsers, ...). The only
// differences are:
//   - property id resolution prefers `firebaseAnalyticsPropertyId` (falls
//     back to the shared `ga4PropertyId` field, since most properties only
//     have one Firebase-linked GA4 property id worth recording)
//   - metric rows are tagged `source: 'firebase_analytics'` instead of
//     `source: 'ga4'`, so reports can distinguish app analytics counted via
//     Firebase's linked property from a separate web GA4 property on the
//     same PiB property.

import { pullDaily as ga4PullDaily } from '@/lib/integrations/ga4/pull-daily'
import type { Ga4Client } from '@/lib/integrations/ga4/client'
import type { Connection, PullResult } from '@/lib/integrations/types'
import type { Property } from '@/lib/properties/types'

export interface FirebaseAnalyticsPullDailyDeps {
  /** Override for tests — ignored in prod. */
  client?: Ga4Client
  /** Stable "now" for tests. */
  now?: Date
  /** Toggle the source/medium second call. Defaults to true. */
  includeSourceMedium?: boolean
}

/** Resolve the Firebase-linked GA4 property id: meta > property config > shared ga4PropertyId fallback. */
function resolveFirebaseAnalyticsPropertyId(input: {
  connection: Connection
  property: Property | null
}): string | undefined {
  const metaId = input.connection.meta?.firebaseAnalyticsPropertyId as string | undefined
  if (metaId) return metaId

  const revCfg = input.property?.config?.revenue ?? {}
  return revCfg.firebaseAnalyticsPropertyId ?? revCfg.ga4PropertyId
}

/**
 * Pull daily Firebase Analytics metrics for a connection. Delegates entirely
 * to the GA4 adapter's `pullDaily` — same Data API, same metric set, same
 * soft-fail/hard-fail behavior — with `source: 'firebase_analytics'` and
 * Firebase-Analytics-aware property id resolution.
 */
export async function pullDaily(
  input: { connection: Connection; window?: { from: string; to: string } },
  deps: FirebaseAnalyticsPullDailyDeps = {},
): Promise<PullResult> {
  return ga4PullDaily(input, {
    client: deps.client,
    now: deps.now,
    includeSourceMedium: deps.includeSourceMedium,
    source: 'firebase_analytics',
    providerLabel: 'Firebase Analytics',
    resolvePropertyId: resolveFirebaseAnalyticsPropertyId,
  })
}
