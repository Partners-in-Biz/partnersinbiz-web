// app/api/v1/admin/system/social-apis/route.ts
//
// US-298 — Per-platform social API health for the operator control plane.
//
// Reads the real `social_accounts` connected-account/token data (no mocks) and
// derives, per platform:
//   - connection status (active / token_expired / disconnected / rate_limited)
//   - token-expiry warnings (from the encrypted token block's expiresAt)
//   - outage detection (accounts carrying a recent lastError / failed status)
//   - re-auth prompts (token_expired / disconnected accounts that need a fresh
//     OAuth connect)
//   - rate-limit remaining + reset (surfaced from platformMeta.rateLimit when a
//     provider has persisted it; honestly reported as "not tracked" otherwise)
//
// Auth: admin (withAuth). Envelope: { success, data }.
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const PLATFORMS: { key: string; label: string }[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'threads', label: 'Threads' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'bluesky', label: 'Bluesky' },
  { key: 'mastodon', label: 'Mastodon' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'dribbble', label: 'Dribbble' },
]

// Warn when a token expires within this window.
const TOKEN_EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000
// An account whose lastError fired within this window counts as an active outage.
const OUTAGE_RECENCY_MS = 24 * 60 * 60 * 1000

type ConnHealth = 'healthy' | 'degraded' | 'down' | 'no_accounts'

interface RateLimitInfo {
  tracked: boolean
  remaining: number | null
  limit: number | null
  resetAt: string | null
}

interface PlatformHealth {
  platform: string
  label: string
  connection: ConnHealth
  totals: { total: number; active: number; tokenExpired: number; disconnected: number; rateLimited: number }
  tokenExpiry: { expiringSoon: number; expired: number; nextExpiryAt: string | null }
  outage: { active: boolean; affected: number; lastError: string | null; lastErrorAt: string | null }
  reAuthRequired: { count: number; accounts: { id: string; orgId: string; displayName: string; status: string }[] }
  rateLimit: RateLimitInfo
}

function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch { /* noop */ } }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch { /* noop */ } }
    const seconds = v.seconds ?? v._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function isoOrNull(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** Pull a normalized rate-limit snapshot from a provider's persisted meta. */
function readRateLimit(metas: Record<string, unknown>[]): RateLimitInfo {
  let best: RateLimitInfo | null = null
  for (const meta of metas) {
    const rl = (meta?.rateLimit ?? meta?.rate_limit) as Record<string, unknown> | undefined
    if (!rl || typeof rl !== 'object') continue
    const remaining = typeof rl.remaining === 'number' ? rl.remaining : null
    const limit = typeof rl.limit === 'number' ? rl.limit : null
    const resetMs = tsToMillis(rl.resetAt ?? rl.reset ?? rl.reset_at)
    const candidate: RateLimitInfo = { tracked: true, remaining, limit, resetAt: isoOrNull(resetMs) }
    // Prefer the lowest remaining (closest to exhaustion) for the platform view.
    if (!best || (remaining != null && (best.remaining == null || remaining < best.remaining))) {
      best = candidate
    }
  }
  return best ?? { tracked: false, remaining: null, limit: null, resetAt: null }
}

export const GET = withAuth('admin', async (_req: NextRequest) => {
  const snap = await adminDb.collection('social_accounts').limit(2000).get()
  const now = Date.now()

  // Bucket accounts by platform.
  const byPlatform = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
  for (const doc of snap.docs) {
    const platform = str(doc.data().platform).toLowerCase()
    if (!platform) continue
    const bucket = byPlatform.get(platform) ?? []
    bucket.push(doc)
    byPlatform.set(platform, bucket)
  }

  const platforms: PlatformHealth[] = PLATFORMS.map(({ key, label }) => {
    const docs = byPlatform.get(key) ?? []
    const totals = { total: 0, active: 0, tokenExpired: 0, disconnected: 0, rateLimited: 0 }
    let expiringSoon = 0
    let expired = 0
    let nextExpiryAt: number | null = null
    let outageAffected = 0
    let lastError: string | null = null
    let lastErrorAt: number | null = null
    const reAuth: PlatformHealth['reAuthRequired']['accounts'] = []
    const metas: Record<string, unknown>[] = []

    for (const doc of docs) {
      const d = doc.data()
      const status = str(d.status, 'active')
      totals.total += 1
      if (status === 'active') totals.active += 1
      if (status === 'token_expired') totals.tokenExpired += 1
      if (status === 'disconnected') totals.disconnected += 1
      if (status === 'rate_limited') totals.rateLimited += 1

      if (d.platformMeta && typeof d.platformMeta === 'object') metas.push(d.platformMeta as Record<string, unknown>)

      // Token expiry.
      const expMs = tsToMillis((d.encryptedTokens as Record<string, unknown> | undefined)?.expiresAt)
      if (expMs != null) {
        if (expMs <= now) expired += 1
        else if (expMs - now <= TOKEN_EXPIRY_WARN_MS) expiringSoon += 1
        if (nextExpiryAt == null || expMs < nextExpiryAt) nextExpiryAt = expMs
      }

      // Outage / errors.
      const errText = str(d.lastError)
      const updatedMs = tsToMillis(d.updatedAt)
      if (errText || status === 'token_expired' || status === 'disconnected') {
        const recent = updatedMs == null || now - updatedMs <= OUTAGE_RECENCY_MS
        if (errText && recent) {
          outageAffected += 1
          if (lastErrorAt == null || (updatedMs != null && updatedMs > lastErrorAt)) {
            lastError = errText
            lastErrorAt = updatedMs
          }
        }
      }

      // Re-auth prompts.
      if (status === 'token_expired' || status === 'disconnected') {
        reAuth.push({
          id: doc.id,
          orgId: str(d.orgId),
          displayName: str(d.displayName, d.username ? str(d.username) : doc.id),
          status,
        })
      }
    }

    let connection: ConnHealth
    if (totals.total === 0) connection = 'no_accounts'
    else if (totals.active === 0) connection = 'down'
    else if (totals.tokenExpired > 0 || totals.disconnected > 0 || totals.rateLimited > 0 || outageAffected > 0) connection = 'degraded'
    else connection = 'healthy'

    return {
      platform: key,
      label,
      connection,
      totals,
      tokenExpiry: { expiringSoon, expired, nextExpiryAt: isoOrNull(nextExpiryAt) },
      outage: { active: outageAffected > 0, affected: outageAffected, lastError, lastErrorAt: isoOrNull(lastErrorAt) },
      reAuthRequired: { count: reAuth.length, accounts: reAuth.slice(0, 25) },
      rateLimit: readRateLimit(metas),
    }
  })

  const connectedPlatforms = platforms.filter((p) => p.totals.total > 0)
  const summary = {
    totalAccounts: platforms.reduce((acc, p) => acc + p.totals.total, 0),
    activeAccounts: platforms.reduce((acc, p) => acc + p.totals.active, 0),
    platformsConnected: connectedPlatforms.length,
    platformsHealthy: platforms.filter((p) => p.connection === 'healthy').length,
    platformsDegraded: platforms.filter((p) => p.connection === 'degraded').length,
    platformsDown: platforms.filter((p) => p.connection === 'down').length,
    tokensExpiringSoon: platforms.reduce((acc, p) => acc + p.tokenExpiry.expiringSoon, 0),
    tokensExpired: platforms.reduce((acc, p) => acc + p.tokenExpiry.expired, 0),
    reAuthRequired: platforms.reduce((acc, p) => acc + p.reAuthRequired.count, 0),
    activeOutages: platforms.filter((p) => p.outage.active).length,
  }

  return apiSuccess({ summary, platforms, generatedAt: new Date().toISOString() })
})
