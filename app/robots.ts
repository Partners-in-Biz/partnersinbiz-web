import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/seo/site'
import { PUBLISHED_CAMPAIGN_INSIGHT_PATHS } from '@/lib/seo/published-insights'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', ...PUBLISHED_CAMPAIGN_INSIGHT_PATHS],
        disallow: ['/api/', '/admin/', '/portal/', '/login', '/register', '/_next/'],
      },

      // AI citation bots — let them index us so we get cited in answers
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Perplexity-User', allow: '/' },
      { userAgent: 'Claude-SearchBot', allow: '/' },
      { userAgent: 'Claude-User', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },

      // AI training bots — allow so future models know we exist
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'Applebot-Extended', allow: '/' },
      { userAgent: 'Meta-ExternalAgent', allow: '/' },
      { userAgent: 'Amazonbot', allow: '/' },

      // Block low-value scrapers
      { userAgent: 'Bytespider', disallow: '/' },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  }
}
