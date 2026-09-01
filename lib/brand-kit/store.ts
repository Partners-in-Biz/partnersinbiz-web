// lib/brand-kit/store.ts
//
// Server-side helpers for reading the brand kit. Falls back to the legacy
// `organizations/{orgId}.settings.brandColors` shape used by older callers
// so existing orgs without a brand_kits doc still get their colors applied.

import { adminDb } from '@/lib/firebase/admin'
import { defaultBrandKit, type BrandKit, type BrandKitSocial } from './types'
import { brandKitDocId, type MarketingOwnerContext } from '@/lib/social/account-scope'

/**
 * Fetch the brand kit for an org. Returns defaults (with overrides from
 * the legacy `organizations.settings` shape, when present) if no
 * `brand_kits/{orgId}` doc exists. Never throws — bad data falls back to
 * the defaults.
 */
export async function getBrandKitForOrg(orgId: string): Promise<BrandKit> {
  const fallback = defaultBrandKit(orgId)
  try {
    const snap = await adminDb.collection('brand_kits').doc(orgId).get()
    if (snap.exists) {
      const data = snap.data() ?? {}
      return {
        ...fallback,
        ...sanitize(data, orgId),
      }
    }
  } catch {
    // fall through to legacy lookup
  }

  // Legacy: pull a few fields from organizations/{orgId}.settings.* if
  // brand_kits doesn't exist yet. Migration over time.
  try {
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    if (orgSnap.exists) {
      const data = orgSnap.data() ?? {}
      const name = typeof data.name === 'string' ? data.name : ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settings = (data.settings ?? {}) as Record<string, any>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const brandColors = (settings.brandColors ?? {}) as Record<string, any>
      return {
        ...fallback,
        brandName: name || fallback.brandName,
        primaryColor: typeof brandColors.primary === 'string' ? brandColors.primary : fallback.primaryColor,
        secondaryColor: typeof brandColors.secondary === 'string' ? brandColors.secondary : fallback.secondaryColor,
        accentColor: typeof brandColors.accent === 'string' ? brandColors.accent : fallback.accentColor,
        defaultFromName: typeof settings.defaultFromName === 'string' ? settings.defaultFromName : fallback.defaultFromName,
        postalAddress: typeof settings.postalAddress === 'string' ? settings.postalAddress : fallback.postalAddress,
      }
    }
  } catch {
    // ignore
  }

  return fallback
}

export async function getBrandKitForOwner(orgId: string, owner: MarketingOwnerContext): Promise<BrandKit> {
  const docId = brandKitDocId(orgId, owner)
  if (owner.owner === 'org' || docId === orgId) return getBrandKitForOrg(orgId)

  const fallback = defaultBrandKit(orgId)
  try {
    const snap = await adminDb.collection('brand_kits').doc(docId).get()
    if (snap.exists) {
      const data = snap.data() ?? {}
      return {
        ...fallback,
        ...sanitize(data, orgId),
      }
    }
  } catch {
    // company/personal kits do not fall back to org brand — that would mix owners
  }
  return fallback
}

export function brandKitWriteDocId(orgId: string, owner: MarketingOwnerContext): string {
  return brandKitDocId(orgId, owner)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitize(raw: Record<string, any>, orgId: string): Partial<BrandKit> {
  const out: Partial<BrandKit> = { orgId }
  const stringKeys: (keyof BrandKit)[] = [
    'brandName',
    'logoUrl',
    'logoUrlDark',
    'faviconUrl',
    'primaryColor',
    'secondaryColor',
    'accentColor',
    'backgroundColor',
    'textColor',
    'mutedTextColor',
    'fontFamilyPrimary',
    'fontFamilyHeadings',
    'defaultFromName',
    'defaultFromLocal',
    'defaultReplyTo',
    'postalAddress',
    'brandVoiceId',
  ]
  for (const k of stringKeys) {
    const v = raw[k as string]
    if (typeof v === 'string') (out as Record<string, unknown>)[k as string] = v
  }
  if (typeof raw.fontSizeBase === 'number') out.fontSizeBase = raw.fontSizeBase
  if (raw.social && typeof raw.social === 'object') {
    const s = raw.social as Record<string, unknown>
    const social: BrandKitSocial = {}
    for (const key of ['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'tiktok'] as const) {
      if (typeof s[key] === 'string') social[key] = s[key] as string
    }
    out.social = social
  }
  if (raw.customVoice && typeof raw.customVoice === 'object') {
    out.customVoice = raw.customVoice
  }
  if (raw.updatedAt?.toDate) out.updatedAt = raw.updatedAt
  return out
}
