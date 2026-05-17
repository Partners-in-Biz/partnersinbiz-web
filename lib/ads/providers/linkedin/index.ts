// lib/ads/providers/linkedin/index.ts
//
// Real LinkedIn ads provider — replaces the Phase 1 stub. Phase 1 surface
// (OAuth + listAdAccounts) is implemented here. Phase 2+ methods (upsertCampaign,
// upsertAdSet, etc.) are intentionally left undefined — routes call the
// sibling helpers in `./campaigns`, `./adsets`, `./ads`, `./creative-sync`
// directly so each helper can ship as an independently-committable file.
import type { AdProvider } from '@/lib/ads/provider'
import type { AdAccount } from '@/lib/ads/types'
import { buildAuthorizeUrl, exchangeCode, refreshToken } from './oauth'
import { listAdAccounts as listLinkedinAdAccounts } from './accounts'

export const linkedinProvider: AdProvider = {
  platform: 'linkedin',

  getAuthorizeUrl({ redirectUri, state }) {
    return buildAuthorizeUrl({ redirectUri, state })
  },

  async exchangeCodeForToken({ code, redirectUri }) {
    const t = await exchangeCode({ code, redirectUri })
    return {
      accessToken: t.accessToken,
      expiresInSeconds: t.expiresInSeconds,
      // LinkedIn issues 60-day tokens directly on initial exchange — no swap needed,
      // and there's no member-URN-by-token endpoint usable in this scope.
    }
  },

  async toLongLivedToken({ accessToken }) {
    // LinkedIn access tokens are already long-lived (60 days). No swap.
    return { accessToken, expiresInSeconds: 60 * 24 * 60 * 60 }
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
    const accounts = await listLinkedinAdAccounts({ accessToken })
    // Map LinkedIn ad-account → canonical AdAccount. The canonical `id` field
    // holds the FULL URN (matching how connections/account PATCH validates
    // and how `conn.meta.linkedin.selectedAdAccountUrn` persists). Display name
    // falls back to the numeric id.
    return accounts.map((a) => ({
      id: a.urn,
      name: a.name ?? a.id,
      currency: a.currency ?? 'USD', // LinkedIn returns currency for all ACTIVE/DRAFT accounts; fallback for edge cases
      timezone: 'UTC', // LinkedIn Marketing API does not return tz on adAccounts list; callers should not rely on this value
      // status is optional on AdAccount; map LinkedIn status string to the canonical union where possible
      status: (['ACTIVE', 'DISABLED', 'UNSETTLED', 'PENDING_RISK_REVIEW', 'IN_GRACE_PERIOD'] as const).includes(
        a.status as 'ACTIVE' | 'DISABLED' | 'UNSETTLED' | 'PENDING_RISK_REVIEW' | 'IN_GRACE_PERIOD'
      )
        ? (a.status as AdAccount['status'])
        : 'UNKNOWN',
    }))
  },
}
