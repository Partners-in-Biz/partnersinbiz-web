const BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export interface PerformanceOpportunity {
  id: string
  title: string
  description: string
  savingsMs: number
}

export interface PerformanceResult {
  url: string
  strategy: 'mobile' | 'desktop'
  score: number       // 0-100 performance score
  lcp?: number        // ms
  cls?: number        // raw score
  inp?: number        // ms (interactive proxy)
  ttfb?: number       // ms (server-response-time)
  tbt?: number        // ms (total-blocking-time)
  speedIndex?: number // ms
  opportunities: PerformanceOpportunity[]
}

export async function runPerformance(url: string, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<PerformanceResult> {
  const key = process.env.PAGESPEED_API_KEY
  const params = new URLSearchParams({ url, strategy })
  params.append('category', 'performance')
  params.append('category', 'seo')
  if (key) params.set('key', key)
  const res = await fetch(`${BASE}?${params.toString()}`)
  if (!res.ok) throw new Error(`PageSpeed error ${res.status}: ${await res.text().catch(() => '')}`)
  const json = await res.json()
  const cats = json.lighthouseResult?.categories ?? {}
  const audits = json.lighthouseResult?.audits ?? {}

  const score = Math.round((cats.performance?.score ?? 0) * 100)
  const lcp = audits['largest-contentful-paint']?.numericValue as number | undefined
  const cls = audits['cumulative-layout-shift']?.numericValue as number | undefined
  const inp = audits['interactive']?.numericValue as number | undefined
  const ttfb = audits['server-response-time']?.numericValue as number | undefined
  const tbt = audits['total-blocking-time']?.numericValue as number | undefined
  const speedIndex = audits['speed-index']?.numericValue as number | undefined

  // Extract opportunities
  const opportunities: PerformanceOpportunity[] = []
  for (const [id, audit] of Object.entries(audits) as [string, any][]) {
    if (audit?.details?.type === 'opportunity' && (audit.details.overallSavingsMs ?? 0) > 0) {
      opportunities.push({
        id,
        title: audit.title ?? id,
        description: audit.description ?? '',
        savingsMs: Math.round(audit.details.overallSavingsMs ?? 0),
      })
    }
  }
  // Sort by savings desc
  opportunities.sort((a, b) => b.savingsMs - a.savingsMs)

  return { url, strategy, score, lcp, cls, inp, ttfb, tbt, speedIndex, opportunities }
}
