/**
 * Backlink profile analysis (US-120).
 *
 * Reads the sprint's discovered backlinks from `seo_backlinks` and aggregates
 * them into a referring-domain profile: counts, new/lost this month, anchor
 * text, DoFollow/NoFollow split, and first-seen dates. This is the monitoring
 * view, distinct from the sprint's backlink-acquisition pipeline (which tracks
 * outreach status). Here every live/submitted link is treated as a real,
 * observed inbound link.
 *
 * No AI, no Node-only imports beyond Firestore admin (server-only by design —
 * this is consumed from API routes, not the browser).
 */
import { adminDb } from '@/lib/firebase/admin'
import type { SeoBacklink } from './types'

export type BacklinkRel = 'dofollow' | 'nofollow'

export interface BacklinkRow {
  id: string
  domain: string
  sourceUrl: string
  targetUrl?: string
  anchorText: string
  rel: BacklinkRel
  domainAuthority: number | null
  firstSeen: string
  lastSeen: string
  status: SeoBacklink['status']
  type: SeoBacklink['type']
  discoveredVia: SeoBacklink['discoveredVia']
}

export interface ReferringDomain {
  domain: string
  links: number
  domainAuthority: number | null
  dofollow: number
  nofollow: number
  firstSeen: string
  isNew: boolean
}

export interface BacklinkProfile {
  totals: {
    backlinks: number
    referringDomains: number
    dofollow: number
    nofollow: number
    newThisMonth: number
    lostThisMonth: number
  }
  referringDomains: ReferringDomain[]
  links: BacklinkRow[]
  topAnchors: { anchor: string; count: number }[]
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toIso(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const maybe = value as { toMillis?: () => number }
  if (typeof maybe.toMillis === 'function') return new Date(maybe.toMillis()).toISOString()
  return String(value)
}

function domainFromUrl(raw: string): string {
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  }
}

/** Anchor text is persisted in `notes` as `Anchor: <text>` by the Bing pull. */
function anchorFromNotes(notes?: string): string {
  if (!notes) return ''
  const m = notes.match(/Anchor:\s*(.+)$/i)
  return m ? m[1].trim() : ''
}

/** DoFollow vs NoFollow — persisted in notes when known, otherwise inferred. */
function relFromNotes(notes?: string): BacklinkRel {
  if (notes && /nofollow/i.test(notes)) return 'nofollow'
  return 'dofollow'
}

function normalizeBacklink(id: string, d: SeoBacklink): BacklinkRow {
  const sourceUrl = d.url || d.source || ''
  const domain = d.domain ? d.domain.replace(/^www\./, '') : domainFromUrl(sourceUrl)
  const firstSeen = toIso(d.liveAt) || toIso(d.submittedAt) || toIso(d.createdAt)
  return {
    id,
    domain,
    sourceUrl,
    targetUrl: undefined,
    anchorText: anchorFromNotes(d.notes),
    rel: relFromNotes(d.notes),
    domainAuthority: typeof d.theirDR === 'number' ? d.theirDR : null,
    firstSeen,
    lastSeen: toIso(d.liveAt) || firstSeen,
    status: d.status,
    type: d.type,
    discoveredVia: d.discoveredVia,
  }
}

/**
 * Build the full backlink profile for a sprint.
 *
 * Only "observed" links count toward the live profile: status `live` or
 * `submitted`. `lost` links contribute to lost-this-month but not the live
 * referring-domain set.
 */
export async function buildBacklinkProfile(sprintId: string): Promise<BacklinkProfile> {
  const snap = await adminDb
    .collection('seo_backlinks')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()

  const now = Date.now()
  const monthAgo = now - 30 * MS_PER_DAY

  const all = snap.docs.map((doc) => normalizeBacklink(doc.id, doc.data() as SeoBacklink))
  const live = all.filter((l) => l.status === 'live' || l.status === 'submitted')
  const lost = all.filter((l) => l.status === 'lost')

  // Referring domains
  const domainMap = new Map<string, ReferringDomain>()
  for (const link of live) {
    if (!link.domain) continue
    const existing = domainMap.get(link.domain)
    const firstSeenMs = link.firstSeen ? new Date(link.firstSeen).getTime() : now
    if (existing) {
      existing.links += 1
      if (link.rel === 'dofollow') existing.dofollow += 1
      else existing.nofollow += 1
      if (link.domainAuthority != null && (existing.domainAuthority == null || link.domainAuthority > existing.domainAuthority)) {
        existing.domainAuthority = link.domainAuthority
      }
      if (firstSeenMs < new Date(existing.firstSeen).getTime()) {
        existing.firstSeen = link.firstSeen
        existing.isNew = firstSeenMs >= monthAgo
      }
    } else {
      domainMap.set(link.domain, {
        domain: link.domain,
        links: 1,
        domainAuthority: link.domainAuthority,
        dofollow: link.rel === 'dofollow' ? 1 : 0,
        nofollow: link.rel === 'nofollow' ? 1 : 0,
        firstSeen: link.firstSeen,
        isNew: firstSeenMs >= monthAgo,
      })
    }
  }

  const referringDomains = Array.from(domainMap.values()).sort(
    (a, b) => (b.domainAuthority ?? -1) - (a.domainAuthority ?? -1) || b.links - a.links,
  )

  // Anchor frequency
  const anchorMap = new Map<string, number>()
  for (const link of live) {
    const a = link.anchorText || '(no anchor text)'
    anchorMap.set(a, (anchorMap.get(a) ?? 0) + 1)
  }
  const topAnchors = Array.from(anchorMap.entries())
    .map(([anchor, count]) => ({ anchor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  const newThisMonth = live.filter((l) => l.firstSeen && new Date(l.firstSeen).getTime() >= monthAgo).length
  const lostThisMonth = lost.filter((l) => {
    const t = new Date(l.lastSeen || l.firstSeen || '').getTime()
    return Number.isFinite(t) && t >= monthAgo
  }).length

  return {
    totals: {
      backlinks: live.length,
      referringDomains: referringDomains.length,
      dofollow: live.filter((l) => l.rel === 'dofollow').length,
      nofollow: live.filter((l) => l.rel === 'nofollow').length,
      newThisMonth,
      lostThisMonth,
    },
    referringDomains,
    links: live.sort((a, b) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime()),
    topAnchors,
  }
}

/**
 * Generate a Google-format disavow file from a set of domains.
 * https://support.google.com/webmasters/answer/2648487
 */
export function buildDisavowFile(domains: string[], generatedFor: string): string {
  const header = [
    `# Disavow file for ${generatedFor}`,
    `# Generated by Partners in Biz on ${new Date().toISOString().slice(0, 10)}`,
    `# Upload at https://search.google.com/search-console/disavow-links`,
    '',
  ]
  const lines = Array.from(new Set(domains.map((d) => d.replace(/^www\./, '').trim())))
    .filter(Boolean)
    .map((d) => `domain:${d}`)
  return [...header, ...lines].join('\n') + '\n'
}
