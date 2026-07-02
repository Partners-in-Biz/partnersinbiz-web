// lib/integrations/firebase_analytics/index.ts
//
// Default IntegrationAdapter export for Firebase Analytics.
//
// Firebase Analytics data for an app is served through GA4's Data API using
// the Firebase-linked GA4 property id — Firebase does not expose a separate
// reporting API. This adapter is therefore a thin variant of the GA4
// adapter: same OAuth client/scope (lib/integrations/ga4/oauth), same Data
// API client (lib/integrations/ga4/client), same core metrics (sessions,
// screenPageViews, totalUsers, newUsers, engagedSessions, bounceRate,
// averageSessionDuration, conversions). It exists as a distinct provider
// (`firebase_analytics`, separate connection doc + separate `metrics.source`
// tag) so an org can connect a web GA4 property and an app's Firebase-linked
// GA4 property on the same PiB property and tell the two apart in reports.

import type { Connection, IntegrationAdapter } from '@/lib/integrations/types'
import { maybeDecryptCredentials } from '@/lib/integrations/crypto'
import { setConnectionStatus } from '@/lib/integrations/connections'
import {
  FIREBASE_ANALYTICS_SCOPES,
  beginOAuth,
  completeOAuth,
  revokeToken,
} from './oauth'
import { pullDaily } from './pull-daily'
import type { Ga4Credentials } from '@/lib/integrations/ga4/schema'
import { registerAdapter } from '@/lib/integrations/registry'

const adapter: IntegrationAdapter = {
  provider: 'firebase_analytics',
  authKind: 'oauth2',

  display: {
    name: 'Firebase Analytics',
    description:
      'App engagement analytics via the Firebase-linked GA4 property — sessions, users, screen views, conversions.',
    iconKey: 'firebase',
    docsUrl:
      'https://developers.google.com/analytics/devguides/reporting/data/v1',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  },

  beginOAuth: async (input) => beginOAuth(input),

  completeOAuth: async (input) => completeOAuth(input),

  pullDaily: async ({ connection, window }) => pullDaily({ connection, window }),

  revoke: async ({ connection }: { connection: Connection }) => {
    const creds = maybeDecryptCredentials<Ga4Credentials>(
      connection.credentialsEnc,
      connection.orgId,
    )
    if (creds?.refreshToken) {
      await revokeToken(creds.refreshToken)
    } else if (creds?.accessToken) {
      await revokeToken(creds.accessToken)
    }
    await setConnectionStatus({
      propertyId: connection.propertyId,
      provider: 'firebase_analytics',
      status: 'paused',
    })
  },
}

// Register at module-load. The registry imports this file once.
registerAdapter(adapter)

export { FIREBASE_ANALYTICS_SCOPES }
export default adapter
