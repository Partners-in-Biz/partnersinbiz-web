import type { MetadataRoute } from 'next'
import { SITE, SERVICES, CASE_STUDIES } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'
import { listLiveInsightEntries } from '@/lib/content/posts-firestore'
import { PUBLISHED_CAMPAIGN_INSIGHT_SLUGS } from '@/lib/seo/published-insights'
import { PUBLIC_TOOLS } from '@/lib/tools/catalog'
import { PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'
import { adminDb } from '@/lib/firebase/admin'

const SITEMAP_CONFIG_COLLECTION = 'admin_sitemap_config'
const SITEMAP_CONFIG_DOC_ID = 'default'

async function readExcludedPaths(): Promise<Set<string>> {
  try {
    const snap = await adminDb.collection(SITEMAP_CONFIG_COLLECTION).doc(SITEMAP_CONFIG_DOC_ID).get()
    const paths = Array.isArray(snap.data()?.excludedPaths)
      ? snap.data()?.excludedPaths.filter((path: unknown): path is string => typeof path === 'string' && path.trim().startsWith('/'))
      : []
    return new Set(paths)
  } catch {
    return new Set()
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticLastModified = new Date('2026-06-01')
  const campaignLastModified = new Date('2026-06-03')
  const excludedPaths = await readExcludedPaths()

  const staticPages: MetadataRoute.Sitemap = [
    '',
    '/work',
    '/services',
    '/gauteng-growth-audit',
    '/about',
    '/our-process',
    '/insights',
    '/tools',
    '/pricing',
    '/properties',
    '/partner-with-us',
    '/faq',
    '/book-a-call',
    '/start-a-project',
    '/privacy-policy',
    '/terms-of-service',
  ].map((path) => ({ url: `${SITE.url}${path}`, lastModified: staticLastModified }))

  const services: MetadataRoute.Sitemap = SERVICES.map((s) => ({
    url: `${SITE.url}/services/${s.slug}`,
    lastModified: staticLastModified,
  }))

  const work: MetadataRoute.Sitemap = CASE_STUDIES.map((c) => ({
    url: `${SITE.url}/work/${c.slug}`,
    lastModified: staticLastModified,
  }))

  const tools: MetadataRoute.Sitemap = PUBLIC_TOOLS.map((tool) => ({
    url: `${SITE.url}/tools/${tool.slug}`,
    lastModified: staticLastModified,
  }))

  const partnerOpportunities: MetadataRoute.Sitemap = PARTNER_OPPORTUNITIES.map((opportunity) => ({
    url: `${SITE.url}${opportunity.href}`,
    lastModified: staticLastModified,
  }))

  const insights: MetadataRoute.Sitemap = POSTS.map((p) => ({
    url: `${SITE.url}/insights/${p.slug}`,
    lastModified: new Date(p.dateModified ?? p.datePublished),
  }))

  const liveInsightEntries = await listLiveInsightEntries().catch(() => [])
  const staticInsightSlugs = new Set(POSTS.map(p => p.slug))
  const dynamicInsightMap = new Map<string, string | null>()
  for (const slug of PUBLISHED_CAMPAIGN_INSIGHT_SLUGS) {
    dynamicInsightMap.set(slug, campaignLastModified.toISOString())
  }
  for (const entry of liveInsightEntries) {
    dynamicInsightMap.set(entry.slug, entry.lastModified)
  }

  const publishedCampaignInsights: MetadataRoute.Sitemap = Array.from(dynamicInsightMap.entries())
    .filter(([slug]) => !staticInsightSlugs.has(slug))
    .map(slug => ({
      url: `${SITE.url}/insights/${slug[0]}`,
      lastModified: slug[1] ? new Date(slug[1]) : campaignLastModified,
    }))

  return [...staticPages, ...services, ...work, ...tools, ...partnerOpportunities, ...insights, ...publishedCampaignInsights]
    .filter((entry) => !excludedPaths.has(new URL(entry.url).pathname))
}
