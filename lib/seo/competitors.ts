/**
 * Competitor tracker (US-144).
 *
 * Tracks up to 5 competitor domains per sprint. For each competitor we capture
 * a metric snapshot: domain authority (OpenPageRank), an estimated keyword
 * footprint + backlink footprint (Common Crawl inbound links), and the overlap
 * between the competitor's on-page topics and the sprint's tracked keywords.
 *
 * Server-only (Firestore + outbound fetch). Consumed from the API route.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getPageRank } from '@/lib/seo/integrations/openpagerank'
import { findInboundLinks } from '@/lib/seo/integrations/commoncrawl'
import { fetchPage } from '@/lib/seo/tools/page-fetch'
import type { SeoKeyword } from './types'

export const MAX_COMPETITORS = 5

export interface CompetitorMetrics {
  domainAuthority: number | null
  estimatedKeywords: number
  referringDomains: number
  overlapKeywords: string[]
}

export interface TrackedCompetitor {
  id: string
  domain: string
  metrics: CompetitorMetrics
  lastRefreshedAt: string | null
}

export interface CompetitorComparison {
  clientDomain: string
  clientDomainAuthority: number | null
  clientKeywordCount: number
  competitors: TrackedCompetitor[]
  /** keyword -> { client: pos|null, [domain]: covered } for the rank-comparison table */
  overlapMatrix: { keyword: string; clientPosition: number | null; coveredBy: string[] }[]
}

function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
}

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return normalizeDomain(url)
  }
}

const STOP = new Set(['the', 'and', 'for', 'your', 'our', 'with', 'this', 'that', 'from', 'home', 'page', 'contact'])

function extractTopics(html: string): Set<string> {
  const topics = new Set<string>()
  const re = /<(?:title|h1|h2)[^>]*>([\s\S]*?)<\/(?:title|h1|h2)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').toLowerCase()
    const words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w))
    for (let i = 0; i + 2 <= words.length; i++) topics.add(words.slice(i, i + 2).join(' '))
  }
  return topics
}

/** List tracked competitors (without refreshing metrics). */
export async function listCompetitors(sprintId: string): Promise<TrackedCompetitor[]> {
  const snap = await adminDb
    .collection('seo_competitors')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>
    return {
      id: d.id,
      domain: String(data.domain ?? ''),
      metrics: (data.metrics as CompetitorMetrics) ?? { domainAuthority: null, estimatedKeywords: 0, referringDomains: 0, overlapKeywords: [] },
      lastRefreshedAt: (data.lastRefreshedAt as string) ?? null,
    }
  })
}

export async function addCompetitor(sprintId: string, orgId: string, rawDomain: string): Promise<{ id: string } | { error: string }> {
  const domain = normalizeDomain(rawDomain)
  if (!domain || !/\./.test(domain)) return { error: 'Enter a valid domain' }

  const existing = await listCompetitors(sprintId)
  if (existing.length >= MAX_COMPETITORS) return { error: `You can track at most ${MAX_COMPETITORS} competitors per sprint` }
  if (existing.some((c) => c.domain === domain)) return { error: 'That competitor is already tracked' }

  const ref = await adminDb.collection('seo_competitors').add({
    sprintId,
    orgId,
    domain,
    metrics: { domainAuthority: null, estimatedKeywords: 0, referringDomains: 0, overlapKeywords: [] },
    lastRefreshedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    deleted: false,
  })
  return { id: ref.id }
}

export async function removeCompetitor(competitorId: string, orgId: string, bypassOrgCheck = false): Promise<boolean> {
  const ref = adminDb.collection('seo_competitors').doc(competitorId)
  const snap = await ref.get()
  if (!snap.exists) return false
  const data = snap.data() as { orgId?: string }
  if (!bypassOrgCheck && data.orgId !== orgId) return false
  await ref.update({ deleted: true })
  return true
}

/** Refresh metrics for every tracked competitor and return the full comparison. */
export async function refreshAndCompare(sprintId: string, siteUrl: string): Promise<CompetitorComparison> {
  const competitors = await listCompetitors(sprintId)

  // Client keywords for overlap
  const kwSnap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()
  const clientKeywords = kwSnap.docs.map((d) => d.data() as SeoKeyword)
  const clientKwList = clientKeywords.map((k) => ({ keyword: k.keyword.toLowerCase().trim(), position: k.currentPosition ?? null }))

  const clientDomain = domainOf(siteUrl)

  // Domain authority for client + all competitors in one OPR call
  const allDomains = [clientDomain, ...competitors.map((c) => c.domain)].filter(Boolean)
  let ranks: Record<string, number> = {}
  try {
    ranks = await getPageRank(allDomains)
  } catch {
    ranks = {}
  }

  const refreshed: TrackedCompetitor[] = []
  const coverageByKeyword = new Map<string, Set<string>>()

  for (const comp of competitors) {
    // Topics from homepage (best-effort)
    let topics = new Set<string>()
    try {
      const page = await fetchPage(`https://${comp.domain}/`)
      if (page.status < 400) topics = extractTopics(page.html)
    } catch {
      topics = new Set()
    }

    const overlapKeywords = clientKwList
      .filter((k) => topics.has(k.keyword) || Array.from(topics).some((t) => t.includes(k.keyword) || k.keyword.includes(t)))
      .map((k) => k.keyword)

    for (const kw of overlapKeywords) {
      if (!coverageByKeyword.has(kw)) coverageByKeyword.set(kw, new Set())
      coverageByKeyword.get(kw)!.add(comp.domain)
    }

    // Backlink footprint via Common Crawl inbound links
    let referringDomains = 0
    try {
      const inbound = await findInboundLinks(comp.domain, 100)
      referringDomains = new Set(inbound.map((u) => domainOf(u))).size
    } catch {
      referringDomains = 0
    }

    const metrics: CompetitorMetrics = {
      domainAuthority: typeof ranks[comp.domain] === 'number' ? Number(ranks[comp.domain].toFixed(1)) : comp.metrics.domainAuthority,
      estimatedKeywords: topics.size,
      referringDomains,
      overlapKeywords,
    }

    const lastRefreshedAt = new Date().toISOString()
    await adminDb.collection('seo_competitors').doc(comp.id).update({ metrics, lastRefreshedAt })
    refreshed.push({ id: comp.id, domain: comp.domain, metrics, lastRefreshedAt })
  }

  const overlapMatrix = clientKwList
    .filter((k) => coverageByKeyword.has(k.keyword))
    .map((k) => ({
      keyword: k.keyword,
      clientPosition: k.position,
      coveredBy: Array.from(coverageByKeyword.get(k.keyword) ?? []),
    }))
    .sort((a, b) => b.coveredBy.length - a.coveredBy.length)

  return {
    clientDomain,
    clientDomainAuthority: typeof ranks[clientDomain] === 'number' ? Number(ranks[clientDomain].toFixed(1)) : null,
    clientKeywordCount: clientKeywords.length,
    competitors: refreshed,
    overlapMatrix,
  }
}
