/**
 * Content gap analysis (US-119).
 *
 * Fetches a competitor domain, extracts the topics/keywords they target from
 * titles + headings + meta, and compares them against the keywords the sprint
 * already tracks. Keywords the competitor covers but the client does not (or
 * ranks poorly for) become "gaps" with an opportunity score.
 *
 * Opportunity score (0–100) blends:
 *   - coverage gap (client doesn't rank / ranks > 20)   → up to 50 pts
 *   - competitor prominence (how often the term recurs)  → up to 30 pts
 *   - intent value (commercial/solution terms weigh more) → up to 20 pts
 *
 * Server-only (uses fetchPage which touches Firestore). Consumed from the API.
 */
import { fetchPage } from '@/lib/seo/tools/page-fetch'
import { adminDb } from '@/lib/firebase/admin'
import { generateText } from 'ai'
import { BRIEF_MODEL } from '@/lib/ai/client'
import type { SeoKeyword } from './types'

export interface GapKeyword {
  keyword: string
  competitorMentions: number
  clientRanks: boolean
  clientPosition: number | null
  intent: 'problem' | 'solution' | 'brand' | 'informational'
  opportunityScore: number
  sampleSources: string[]
}

export interface GapAnalysisResult {
  competitorDomain: string
  pagesAnalyzed: number
  clientKeywordCount: number
  gaps: GapKeyword[]
  overlap: { keyword: string; clientPosition: number | null }[]
  generatedBy: 'ai' | 'heuristic'
  generatedAt: string
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'our', 'are', 'this', 'that', 'from', 'how', 'what',
  'why', 'when', 'who', 'will', 'can', 'all', 'get', 'best', 'top', 'new', 'more', 'now', 'about',
  'home', 'page', 'contact', 'login', 'sign', 'free', 'help', 'use', 'using', 'into', 'out', 'one',
  'two', 'has', 'have', 'was', 'were', 'they', 'them', 'his', 'her', 'its', 'but', 'not', 'their',
])

function normalizeDomain(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  return trimmed.toLowerCase()
}

function extractHeadings(html: string): string[] {
  const out: string[] = []
  const patterns = [/<title[^>]*>([\s\S]*?)<\/title>/gi, /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/gi]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
  }
  return out
}

function extractInternalLinks(html: string, domain: string, limit: number): string[] {
  const links = new Set<string>()
  const re = /href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && links.size < limit) {
    const href = m[1]
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    try {
      const abs = href.startsWith('http') ? href : `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`
      const u = new URL(abs)
      if (u.hostname.replace(/^www\./, '') === domain) links.add(u.toString().split('#')[0])
    } catch {
      // skip invalid
    }
  }
  return Array.from(links).slice(0, limit)
}

/** Deterministic n-gram keyword extraction with frequency. */
function extractKeywordPhrases(texts: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    // bigrams + trigrams are the useful SEO phrases
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(' ')
        if (phrase.length < 6) continue
        freq.set(phrase, (freq.get(phrase) ?? 0) + 1)
      }
    }
  }
  return freq
}

function classifyIntent(keyword: string): GapKeyword['intent'] {
  const k = keyword.toLowerCase()
  if (/\b(buy|price|pricing|cost|software|tool|platform|service|solution|vs|alternative|best|compare)\b/.test(k)) return 'solution'
  if (/\b(how|what|why|guide|tutorial|tips|examples|meaning|definition)\b/.test(k)) return 'informational'
  if (/\b(problem|issue|fix|error|slow|broken|failing|stuck)\b/.test(k)) return 'problem'
  return 'informational'
}

function intentWeight(intent: GapKeyword['intent']): number {
  switch (intent) {
    case 'solution': return 20
    case 'problem': return 16
    case 'informational': return 10
    default: return 6
  }
}

function scoreOpportunity(g: Omit<GapKeyword, 'opportunityScore'>, maxMentions: number): number {
  // coverage gap
  let coverage = 0
  if (!g.clientRanks) coverage = 50
  else if (g.clientPosition == null) coverage = 40
  else if (g.clientPosition > 20) coverage = 35
  else if (g.clientPosition > 10) coverage = 20
  else coverage = 5
  // competitor prominence
  const prominence = maxMentions > 0 ? Math.round((g.competitorMentions / maxMentions) * 30) : 0
  return Math.min(100, coverage + prominence + intentWeight(g.intent))
}

async function aiRefineKeywords(domain: string, phrases: string[]): Promise<string[] | null> {
  try {
    const { text } = await generateText({
      model: BRIEF_MODEL,
      system:
        'You are an SEO strategist. Given raw candidate phrases scraped from a competitor site, output ONLY a clean numbered list of up to 25 real search keywords a competing business should target. ' +
        'Drop nav labels, brand names, boilerplate, and nonsense fragments. Keep commercial + informational search phrases. One per line, numbered.',
      prompt: `Competitor domain: ${domain}\n\nCandidate phrases (with frequency):\n${phrases.join('\n')}\n\nReturn the cleaned keyword list.`,
      maxOutputTokens: 600,
    })
    const list = text
      .split('\n')
      .map((l) => l.replace(/^[\d\-\*\.\)\s]+/, '').trim().toLowerCase())
      .filter((l) => l.length > 4 && l.split(' ').length >= 2)
    return list.length >= 3 ? Array.from(new Set(list)).slice(0, 25) : null
  } catch {
    return null
  }
}

export async function runGapAnalysis(opts: {
  competitorDomain: string
  sprintId: string
  maxPages?: number
}): Promise<GapAnalysisResult> {
  const competitorDomain = normalizeDomain(opts.competitorDomain)
  const maxPages = Math.min(opts.maxPages ?? 6, 12)

  // 1. Fetch competitor pages
  const root = `https://${competitorDomain}/`
  const texts: string[] = []
  let pagesAnalyzed = 0

  // headingsByUrl lets us attribute a keyword to the pages whose headings contain it
  const headingsByUrl: { url: string; headings: string[] }[] = []

  const rootPage = await fetchPage(root).catch(() => null)
  if (rootPage && rootPage.status < 400) {
    pagesAnalyzed++
    const headings = extractHeadings(rootPage.html)
    texts.push(...headings)
    headingsByUrl.push({ url: root, headings })
    const links = extractInternalLinks(rootPage.html, competitorDomain, maxPages - 1)
    for (const link of links) {
      const page = await fetchPage(link).catch(() => null)
      if (!page || page.status >= 400) continue
      pagesAnalyzed++
      const hs = extractHeadings(page.html)
      texts.push(...hs)
      headingsByUrl.push({ url: link, headings: hs })
    }
  }

  // 2. Extract candidate phrases
  const freq = extractKeywordPhrases(texts)
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([phrase, count]) => `${phrase} (${count})`)

  let candidateKeywords: string[]
  let generatedBy: 'ai' | 'heuristic'
  const refined = ranked.length > 0 ? await aiRefineKeywords(competitorDomain, ranked) : null
  if (refined) {
    candidateKeywords = refined
    generatedBy = 'ai'
  } else {
    candidateKeywords = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p]) => p)
    generatedBy = 'heuristic'
  }

  // 3. Load client keywords for this sprint
  const kwSnap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', opts.sprintId)
    .where('deleted', '==', false)
    .get()
  const clientKeywords = kwSnap.docs.map((d) => d.data() as SeoKeyword)
  const clientMap = new Map(clientKeywords.map((k) => [k.keyword.toLowerCase().trim(), k]))

  // 4. Build gaps + overlap
  const maxMentions = Math.max(1, ...candidateKeywords.map((k) => countMentions(texts, k)))
  const gaps: GapKeyword[] = []
  const overlap: { keyword: string; clientPosition: number | null }[] = []

  for (const keyword of candidateKeywords) {
    const matched = clientMap.get(keyword)
    const clientRanks = !!matched && typeof matched.currentPosition === 'number'
    if (matched && clientRanks && (matched.currentPosition as number) <= 20) {
      overlap.push({ keyword, clientPosition: matched.currentPosition ?? null })
      continue
    }
    const intent = classifyIntent(keyword)
    const competitorMentions = countMentions(texts, keyword)
    const base: Omit<GapKeyword, 'opportunityScore'> = {
      keyword,
      competitorMentions,
      clientRanks,
      clientPosition: matched?.currentPosition ?? null,
      intent,
      sampleSources: headingsByUrl
        .filter((p) => p.headings.some((h) => h.toLowerCase().includes(keyword)))
        .map((p) => p.url)
        .slice(0, 2),
    }
    gaps.push({ ...base, opportunityScore: scoreOpportunity(base, maxMentions) })
  }

  gaps.sort((a, b) => b.opportunityScore - a.opportunityScore)

  return {
    competitorDomain,
    pagesAnalyzed,
    clientKeywordCount: clientKeywords.length,
    gaps,
    overlap,
    generatedBy,
    generatedAt: new Date().toISOString(),
  }
}

function countMentions(texts: string[], keyword: string): number {
  const k = keyword.toLowerCase()
  return texts.reduce((sum, t) => (t.toLowerCase().includes(k) ? sum + 1 : sum), 0) || 1
}
