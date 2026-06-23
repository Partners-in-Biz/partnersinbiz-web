// lib/email/merge-tags.ts
//
// Merge-tag system for email campaigns. Defines the catalogue of supported
// {{tag}} tokens, extracts which tags a piece of content uses, resolves tags
// against a contact (with per-field fallback text when a contact field is
// empty), and validates that every used tag either resolves or has a fallback
// configured before a send is allowed.
//
// Tag syntax: {{tag}} with optional surrounding whitespace, e.g. {{ first_name }}.
// Case-insensitive on the tag key. Unknown tags are left untouched by
// resolveMergeTags but reported by extractMergeTags so the UI can warn.

import type { Contact } from '@/lib/crm/types'

// ── Catalogue ─────────────────────────────────────────────────────────────

export interface MergeTagDef {
  /** The bare key, e.g. "first_name" — used inside {{ }}. */
  key: string
  /** Human label for the picker. */
  label: string
  /** Short description shown in the picker. */
  description: string
  /** Example resolved value for preview. */
  example: string
  /** A sensible default fallback the UI can pre-fill. */
  defaultFallback: string
}

export const MERGE_TAGS: MergeTagDef[] = [
  {
    key: 'first_name',
    label: 'First name',
    description: 'The contact’s first name (derived from their full name).',
    example: 'Sarah',
    defaultFallback: 'there',
  },
  {
    key: 'last_name',
    label: 'Last name',
    description: 'The contact’s last name (derived from their full name).',
    example: 'Jones',
    defaultFallback: '',
  },
  {
    key: 'full_name',
    label: 'Full name',
    description: 'The contact’s full name.',
    example: 'Sarah Jones',
    defaultFallback: 'there',
  },
  {
    key: 'email',
    label: 'Email address',
    description: 'The contact’s email address.',
    example: 'sarah@acme.com',
    defaultFallback: '',
  },
  {
    key: 'company',
    label: 'Company',
    description: 'The contact’s company name.',
    example: 'Acme Inc',
    defaultFallback: 'your company',
  },
  {
    key: 'job_title',
    label: 'Job title',
    description: 'The contact’s job title.',
    example: 'Head of Marketing',
    defaultFallback: '',
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'The contact’s phone number.',
    example: '+27 82 000 0000',
    defaultFallback: '',
  },
]

const TAG_KEYS = new Set(MERGE_TAGS.map((t) => t.key))

/** The list of valid tag keys, e.g. ['first_name', ...]. */
export function mergeTagKeys(): string[] {
  return MERGE_TAGS.map((t) => t.key)
}

export function isKnownMergeTag(key: string): boolean {
  return TAG_KEYS.has(key.toLowerCase().trim())
}

// ── Extraction ──────────────────────────────────────────────────────────────

// Matches {{ key }} — captures the inner key, tolerating surrounding spaces.
const TAG_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export interface ExtractedTags {
  /** All tag keys used (deduped, lowercased), in first-seen order. */
  used: string[]
  /** Subset of `used` that are NOT in the known catalogue. */
  unknown: string[]
}

/**
 * Extract every {{tag}} referenced across the supplied content strings
 * (e.g. subject + bodyHtml). Returns deduped keys + the unknown subset.
 */
export function extractMergeTags(...content: Array<string | null | undefined>): ExtractedTags {
  const seen = new Set<string>()
  const order: string[] = []
  for (const chunk of content) {
    if (!chunk) continue
    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(chunk)) !== null) {
      const key = m[1].toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  return {
    used: order,
    unknown: order.filter((k) => !TAG_KEYS.has(k)),
  }
}

// ── Resolution ────────────────────────────────────────────────────────────

export type MergeTagFallbacks = Record<string, string>

/** Minimal shape needed to resolve tags — accepts a full Contact or a subset. */
export type MergeTagContact = Partial<
  Pick<Contact, 'name' | 'email' | 'company' | 'companyName' | 'jobTitle' | 'phone'>
>

function splitName(name: string): { first: string; last: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { first: '', last: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/**
 * Resolve the raw (un-fallback) value of a single tag for a contact. Returns
 * '' when the underlying field is empty. Unknown tags return null so callers
 * can leave them untouched.
 */
export function resolveTagValue(key: string, contact: MergeTagContact): string | null {
  const k = key.toLowerCase().trim()
  if (!TAG_KEYS.has(k)) return null
  const name = contact.name ?? ''
  const { first, last } = splitName(name)
  switch (k) {
    case 'first_name':
      return first
    case 'last_name':
      return last
    case 'full_name':
      return name.trim()
    case 'email':
      return (contact.email ?? '').trim()
    case 'company':
      return (contact.company || contact.companyName || '').trim()
    case 'job_title':
      return (contact.jobTitle ?? '').trim()
    case 'phone':
      return (contact.phone ?? '').trim()
    default:
      return ''
  }
}

/**
 * Substitute every {{tag}} in `content` with the contact's value. When the
 * resolved value is empty, falls back to `fallbacks[key]` if present, else ''.
 * Unknown tags are left untouched so a stray {{foo}} doesn't silently vanish
 * (the validation gate flags it instead).
 */
export function resolveMergeTags(
  content: string,
  contact: MergeTagContact,
  fallbacks: MergeTagFallbacks = {},
): string {
  if (!content) return content
  return content.replace(TAG_RE, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase()
    if (!TAG_KEYS.has(key)) return whole // leave unknown tags intact
    const resolved = resolveTagValue(key, contact)
    if (resolved && resolved.length > 0) return resolved
    const fb = fallbacks[key]
    return typeof fb === 'string' ? fb : ''
  })
}

// ── Pre-send validation gate ──────────────────────────────────────────────

export interface MergeTagValidation {
  ok: boolean
  /** Known tags used in the content that have NO fallback configured. */
  missingTags: string[]
  /** Unknown {{tags}} that aren't in the catalogue at all. */
  unknownTags: string[]
  /** Every known tag used (for UI display). */
  usedTags: string[]
}

/**
 * Pre-send gate. A campaign passes when every KNOWN merge tag it uses has a
 * non-empty fallback configured (so contacts with empty fields still get
 * sensible copy), and there are no unknown tags. We require fallbacks rather
 * than trusting per-contact data because the audience is heterogeneous —
 * some contacts will be missing company, last name, etc.
 *
 * `email` is treated as always-resolvable (every contact has an address) and
 * therefore never requires a fallback.
 */
export function validateMergeTags(
  html: string,
  subject: string,
  fallbacks: MergeTagFallbacks = {},
): MergeTagValidation {
  const { used, unknown } = extractMergeTags(subject, html)
  const known = used.filter((k) => TAG_KEYS.has(k))
  const ALWAYS_RESOLVABLE = new Set(['email'])

  const missingTags = known.filter((k) => {
    if (ALWAYS_RESOLVABLE.has(k)) return false
    const fb = fallbacks[k]
    return !(typeof fb === 'string' && fb.trim().length > 0)
  })

  return {
    ok: missingTags.length === 0 && unknown.length === 0,
    missingTags,
    unknownTags: unknown,
    usedTags: known,
  }
}
