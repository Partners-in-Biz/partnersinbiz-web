// lib/ads/providers/tiktok/index.ts
//
// Real TikTok ads AdProvider — replaces the Phase 1 stub. Phase 1 surface
// (OAuth + listAdAccounts) is implemented here. Phase 2+ methods (upsertCampaign,
// upsertAdSet, etc.) are intentionally left undefined — routes call the
// sibling helpers directly so each helper can ship as an independently-committable file.
import type { AdProvider } from '@/lib/ads/provider'
import type { AdAccount } from '@/lib/ads/types'
import { buildAuthorizeUrl, exchangeCode, refreshToken } from './oauth'
import { listAdvertisers } from './accounts'
import { randomUUID } from 'crypto'

export const tiktokProvider: AdProvider = {
  platform: 'tiktok',

  getAuthorizeUrl({ redirectUri, state }) {
    // TikTok requires a `rid` param in addition to state — generate it here
    // since the AdProvider interface doesn't accept rid as a separate arg.
    return buildAuthorizeUrl({ redirectUri, state, rid: randomUUID() })
  },

  async exchangeCodeForToken({ code, redirectUri: _redirectUri }) {
    // TikTok uses `auth_code` param name but our AdProvider interface passes
    // it as `code` for cross-platform consistency.
    const t = await exchangeCode({ authCode: code })
    return {
      accessToken: t.accessToken,
      expiresInSeconds: t.expiresInSeconds,
    }
  },

  async toLongLivedToken({ accessToken }) {
    // TikTok issues 24-hour access tokens by default; refresh-token-based
    // continuation handles the long-lived case. No swap step.
    return { accessToken, expiresInSeconds: 24 * 60 * 60 }
  },

  async refreshToken({ refreshToken: rt }) {
    const t = await refreshToken({ refreshToken: rt })
    return {
      accessToken: t.accessToken,
      expiresInSeconds: t.expiresInSeconds,
      refreshToken: t.refreshToken,
    }
  },

  async listAdAccounts({ accessToken }): Promise<AdAccount[]> {
    const advertisers = await listAdvertisers({ accessToken })
    return advertisers.map((a) => ({
      id: a.advertiserId,
      name: a.advertiserName ?? a.advertiserId,
      currency: a.currency ?? 'USD',
      timezone: 'UTC',
      status: 'ACTIVE' as const,
    }))
  },
}
