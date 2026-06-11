// lib/ads/provider.ts
import type { AdAccount, AdPlatform } from './types'

/**
 * The contract every ad platform implementation must fulfill.
 *
 * Phase 1 only exercises `getAuthorizeUrl`, `exchangeCodeForToken`, `refreshToken`,
 * and `listAdAccounts`. The remaining methods are declared here so Phases 2-6 can
 * fill them in per-platform without revisiting the registry or surface.
 */
export interface AdProvider {
  readonly platform: AdPlatform

  // ── Phase 1: OAuth + connection ────────────────────────────────────────────
  getAuthorizeUrl(args: { redirectUri: string; state: string; orgId: string }): string
  exchangeCodeForToken(args: {
    code: string
    redirectUri: string
  }): Promise<{
    accessToken: string
    expiresInSeconds: number
    userId?: string
    refreshToken?: string
    scopes?: string[]
  }>
  /**
   * For Meta: exchange short-lived → long-lived (~60d) via `fb_exchange_token`.
   * Providers that don't have a long-lived swap return the input unchanged.
   */
  toLongLivedToken(args: {
    accessToken: string
  }): Promise<{ accessToken: string; expiresInSeconds: number }>
  refreshToken(args: { refreshToken: string }): Promise<{
    accessToken: string
    expiresInSeconds: number
    refreshToken?: string
  }>
  listAdAccounts(args: { accessToken: string }): Promise<AdAccount[]>

  // ── Phase 2: campaign/adset/ad CRUD (stubbed by Phase 1 impls) ─────────────
  upsertCampaign?(...args: unknown[]): Promise<unknown>
  upsertAdSet?(...args: unknown[]): Promise<unknown>
  upsertAd?(...args: unknown[]): Promise<unknown>
  validateBeforeLaunch?(...args: unknown[]): Promise<unknown>

  // ── Phase 3: creative sync ─────────────────────────────────────────────────
  syncCreative?(...args: unknown[]): Promise<unknown>

  // ── Phase 4: audiences ─────────────────────────────────────────────────────
  customAudienceCRUD?(...args: unknown[]): Promise<unknown>
  savedAudienceCRUD?(...args: unknown[]): Promise<unknown>

  // ── Phase 5: insights ──────────────────────────────────────────────────────
  listInsights?(...args: unknown[]): Promise<unknown>

  // ── Phase 6: CAPI ──────────────────────────────────────────────────────────
  trackConversion?(...args: unknown[]): Promise<unknown>
}

export class NotImplementedError extends Error {
  constructor(provider: AdPlatform, method: string) {
    super(`AdProvider[${provider}].${method} not implemented yet`)
    this.name = 'NotImplementedError'
  }
}

export class UnknownProviderError extends Error {
  constructor(value: string) {
    super(`Unknown ad provider: ${value}`)
    this.name = 'UnknownProviderError'
  }
}

/** Make stub for non-Meta providers in Phase 1. */
export function makeStubProvider(platform: AdPlatform): AdProvider {
  const stub: AdProvider = {
    platform,
    getAuthorizeUrl() {
      throw new NotImplementedError(platform, 'getAuthorizeUrl')
    },
    async exchangeCodeForToken() {
      throw new NotImplementedError(platform, 'exchangeCodeForToken')
    },
    async toLongLivedToken({ accessToken }) {
      return { accessToken, expiresInSeconds: 0 }
    },
    async refreshToken() {
      throw new NotImplementedError(platform, 'refreshToken')
    },
    async listAdAccounts() {
      throw new NotImplementedError(platform, 'listAdAccounts')
    },
  }
  return stub
}
