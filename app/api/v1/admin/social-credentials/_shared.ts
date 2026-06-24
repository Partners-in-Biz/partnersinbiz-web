/**
 * Shared helpers for the social-credentials control plane.
 *
 * The OAuth *secrets* themselves (client id / client secret) live in Vercel
 * environment variables and are never written to Firestore — rotating a real
 * secret happens in the Vercel dashboard / CLI. What this control plane owns is
 * the per-platform *operational metadata*: webhook verification tokens, API
 * version pins, an enabled/disabled toggle, and an append-only rotation log.
 * That metadata lives one doc per platform-variant in the
 * `social_credential_settings` collection, keyed by the variant key
 * (e.g. `facebook`, `linkedin`, `linkedin_org`).
 */
import { getCallbackUrl, getClientCredentials, getOAuthConfig, type LinkedInOAuthMode } from '@/lib/social/oauth-config'
import type { SocialPlatformType } from '@/lib/social/providers/types'

export const SETTINGS_COLLECTION = 'social_credential_settings'

/** Platform *variants* — linkedin is split into personal + organization apps. */
export interface PlatformVariant {
  /** Stable key used as the settings doc id and API path segment. */
  key: string
  label: string
  /** Underlying OAuth platform the env credentials + config resolve from. */
  oauthPlatform: SocialPlatformType
  linkedinMode?: LinkedInOAuthMode
}

export const PLATFORM_VARIANTS: PlatformVariant[] = [
  { key: 'facebook', label: 'Facebook', oauthPlatform: 'facebook' },
  { key: 'instagram', label: 'Instagram', oauthPlatform: 'instagram' },
  { key: 'linkedin', label: 'LinkedIn (personal)', oauthPlatform: 'linkedin', linkedinMode: 'personal' },
  { key: 'linkedin_org', label: 'LinkedIn (organization)', oauthPlatform: 'linkedin', linkedinMode: 'organization' },
  { key: 'tiktok', label: 'TikTok', oauthPlatform: 'tiktok' },
  { key: 'youtube', label: 'YouTube', oauthPlatform: 'youtube' },
  { key: 'twitter', label: 'X / Twitter', oauthPlatform: 'twitter' },
  { key: 'threads', label: 'Threads', oauthPlatform: 'threads' },
  { key: 'reddit', label: 'Reddit', oauthPlatform: 'reddit' },
  { key: 'pinterest', label: 'Pinterest', oauthPlatform: 'pinterest' },
  { key: 'mastodon', label: 'Mastodon', oauthPlatform: 'mastodon' },
  { key: 'dribbble', label: 'Dribbble', oauthPlatform: 'dribbble' },
  { key: 'bluesky', label: 'Bluesky (app password)', oauthPlatform: 'bluesky' },
]

export function findVariant(key: string): PlatformVariant | null {
  return PLATFORM_VARIANTS.find((v) => v.key === key) ?? null
}

/** Mask a secret-ish string, keeping only the last 4 characters visible. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(value.length - 4, 24))}${value.slice(-4)}`
}

export function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? value : new Date(ms).toISOString()
  }
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof v.toDate === 'function') {
      try { return v.toDate().toISOString() } catch { return null }
    }
    const seconds = v._seconds ?? v.seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return null
}

export interface RotationLogEntry {
  at: string | null
  actorUid: string
  note: string
}

export interface PlatformCredentialView {
  key: string
  label: string
  oauthPlatform: SocialPlatformType
  /** Whether env credentials are present for this variant. */
  configured: boolean
  /** Masked client id pulled from env (presence indicator only). */
  clientIdMasked: string | null
  /** Whether the client secret env var is present (never the value). */
  hasClientSecret: boolean
  authUrl: string | null
  tokenUrl: string | null
  callbackUrl: string
  scopes: string[]
  /** Operator-managed settings (Firestore). */
  enabled: boolean
  apiVersion: string | null
  webhookToken: string | null
  webhookTokenMasked: string | null
  lastRotatedAt: string | null
  rotationLog: RotationLogEntry[]
  notes: string
  updatedAt: string | null
}

/** Resolve env-backed OAuth facts for one variant. */
export function resolveVariantOAuth(variant: PlatformVariant) {
  const opts = variant.linkedinMode ? { linkedinMode: variant.linkedinMode } : {}
  const config = getOAuthConfig(variant.oauthPlatform, opts)
  const creds = getClientCredentials(variant.oauthPlatform, opts)
  return {
    config,
    creds,
    callbackUrl: getCallbackUrl(variant.oauthPlatform),
  }
}

/** Merge env facts + Firestore settings into a single client-facing view. */
export function buildCredentialView(
  variant: PlatformVariant,
  settings: Record<string, unknown> | null,
): PlatformCredentialView {
  const { config, creds, callbackUrl } = resolveVariantOAuth(variant)
  const webhookToken = typeof settings?.webhookToken === 'string' ? settings.webhookToken : null
  const rotationLogRaw = Array.isArray(settings?.rotationLog) ? (settings!.rotationLog as Array<Record<string, unknown>>) : []
  const rotationLog: RotationLogEntry[] = rotationLogRaw
    .map((entry) => ({
      at: tsToIso(entry.at),
      actorUid: typeof entry.actorUid === 'string' ? entry.actorUid : 'unknown',
      note: typeof entry.note === 'string' ? entry.note : '',
    }))
    .slice(-10)
    .reverse()

  return {
    key: variant.key,
    label: variant.label,
    oauthPlatform: variant.oauthPlatform,
    configured: Boolean(creds),
    clientIdMasked: maskSecret(creds?.clientId ?? null),
    hasClientSecret: Boolean(creds?.clientSecret),
    authUrl: config?.authUrl ?? null,
    tokenUrl: config?.tokenUrl ?? null,
    callbackUrl: config ? callbackUrl : 'Uses app passwords / not configured',
    scopes: config?.scopes ?? [],
    enabled: settings?.enabled === false ? false : true,
    apiVersion: typeof settings?.apiVersion === 'string' && settings.apiVersion.trim() ? settings.apiVersion.trim() : null,
    webhookToken,
    webhookTokenMasked: maskSecret(webhookToken),
    lastRotatedAt: tsToIso(settings?.lastRotatedAt),
    rotationLog,
    notes: typeof settings?.notes === 'string' ? settings.notes : '',
    updatedAt: tsToIso(settings?.updatedAt),
  }
}
