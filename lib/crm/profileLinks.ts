// Shared website / social / extra URL properties for contacts and companies.

export type ProfileLink = {
  label: string
  url: string
}

export const SOCIAL_PROFILE_KEYS = [
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'github',
  'youtube',
] as const

export type SocialProfileKey = (typeof SOCIAL_PROFILE_KEYS)[number]

export const PROFILE_LINK_FIELDS = [
  { key: 'website', label: 'Website', placeholder: 'https://company.com' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/…' },
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/…' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/…' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/…' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/…' },
] as const

export type ProfileLinkFieldKey = (typeof PROFILE_LINK_FIELDS)[number]['key']

export type ProfileLinkFieldValues = Partial<Record<ProfileLinkFieldKey, string>>

const CONTACT_URL_FIELDS = [
  'website',
  'linkedinUrl',
  'twitterUrl',
  'githubUrl',
  'facebookUrl',
  'instagramUrl',
  'youtubeUrl',
] as const

export type ContactUrlField = (typeof CONTACT_URL_FIELDS)[number]

const CONTACT_FIELD_BY_KEY: Record<Exclude<ProfileLinkFieldKey, never>, ContactUrlField> = {
  website: 'website',
  linkedin: 'linkedinUrl',
  twitter: 'twitterUrl',
  github: 'githubUrl',
  facebook: 'facebookUrl',
  instagram: 'instagramUrl',
  youtube: 'youtubeUrl',
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeProfileUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return ''
  }
  return trimmed
}

export function sanitizeOtherLinks(value: unknown): ProfileLink[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  const out: ProfileLink[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const url = sanitizeProfileUrl(item.url)
    if (!label || !url) continue
    out.push({ label, url })
  }
  return out
}

export function sanitizeSocialProfiles(value: unknown): Partial<Record<SocialProfileKey, string>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return {}
  const out = {} as Partial<Record<SocialProfileKey, string>>
  for (const key of SOCIAL_PROFILE_KEYS) {
    const cleaned = sanitizeProfileUrl(value[key])
    if (cleaned !== undefined) out[key] = cleaned
  }
  return out
}

export function contactValuesFromRecord(record: Record<string, unknown> | null | undefined): ProfileLinkFieldValues {
  const source = record ?? {}
  const values: ProfileLinkFieldValues = {}
  for (const field of PROFILE_LINK_FIELDS) {
    const raw = source[CONTACT_FIELD_BY_KEY[field.key]]
    values[field.key] = typeof raw === 'string' ? raw : ''
  }
  return values
}

export function contactPayloadFromValues(values: ProfileLinkFieldValues): Record<ContactUrlField, string> {
  const payload = {} as Record<ContactUrlField, string>
  for (const field of PROFILE_LINK_FIELDS) {
    payload[CONTACT_FIELD_BY_KEY[field.key]] = (values[field.key] ?? '').trim()
  }
  return payload
}

export function companySocialFromValues(values: ProfileLinkFieldValues): Record<SocialProfileKey, string> {
  const out = {} as Record<SocialProfileKey, string>
  for (const key of SOCIAL_PROFILE_KEYS) {
    out[key] = (values[key] ?? '').trim()
  }
  return out
}

export function hrefForProfileUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
