// lib/ads/providers/google/index.ts
//
// Google Ads provider — Phase 1 (OAuth + connection discovery). Mirrors the
// Meta provider so the generic `[platform]` connection routes
// (`/api/v1/ads/connections/google/{authorize,callback,refresh,ad-accounts}`)
// dispatch to real logic instead of the Phase-1 stub. The Google-namespaced
// routes under `/api/v1/ads/google/*` share the same underlying helpers, so
// both surfaces stay in lockstep.
import type { AdProvider } from '@/lib/ads/provider'
import type { AdAccount } from '@/lib/ads/types'
import {
  buildAdsAuthorizeUrl,
  exchangeAdsCodeForToken,
  refreshAdsAccessToken,
} from './oauth'
import { listAccessibleCustomers } from './customers'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'

export const googleProvider: AdProvider = {
  platform: 'google',
  getAuthorizeUrl: buildAdsAuthorizeUrl,
  exchangeCodeForToken: exchangeAdsCodeForToken,

  // Google has no long-lived-token swap (unlike Meta's fb_exchange_token).
  // Access tokens are short-lived (~1h) and re-minted from the stored refresh
  // token via `refreshToken`. We pass the token through with Google's standard
  // lifetime so the connection records a sane expiry.
  async toLongLivedToken({ accessToken }) {
    return { accessToken, expiresInSeconds: 3600 }
  },

  refreshToken: refreshAdsAccessToken,

  // Best-effort discovery. Google requires the platform `developer-token` on
  // every Ads API call; if it's absent (or the call errors) we return an empty
  // list rather than failing the whole connection. The admin UI's customer
  // picker (`GET /api/v1/ads/google/customers`) performs discovery on demand,
  // which is the canonical path because it surfaces errors to the operator.
  async listAdAccounts({ accessToken }): Promise<AdAccount[]> {
    const developerToken = readDeveloperToken()
    if (!developerToken) return []
    try {
      const customers = await listAccessibleCustomers({ accessToken, developerToken })
      return customers.map((c) => ({
        id: c.customerId,
        name: `Customer ${c.customerId}`,
        currency: '',
        timezone: '',
      }))
    } catch {
      return []
    }
  },
}
