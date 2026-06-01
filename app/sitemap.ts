import type { MetadataRoute } from 'next'
import { SITE, SERVICES, CASE_STUDIES } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date('2026-04-25')

  const staticPages: MetadataRoute.Sitemap = [
    '',
    '/work',
    '/services',
    '/gauteng-growth-audit',
    '/about',
    '/our-process',
    '/insights',
    '/pricing',
    '/products',
    '/start-a-project',
    '/privacy-policy',
    '/terms-of-service',
  ].map((path) => ({ url: `${SITE.url}${path}`, lastModified: now }))

  const services: MetadataRoute.Sitemap = SERVICES.map((s) => ({
    url: `${SITE.url}/services/${s.slug}`,
    lastModified: now,
  }))

  const work: MetadataRoute.Sitemap = CASE_STUDIES.map((c) => ({
    url: `${SITE.url}/work/${c.slug}`,
    lastModified: now,
  }))

  const insights: MetadataRoute.Sitemap = POSTS.map((p) => ({
    url: `${SITE.url}/insights/${p.slug}`,
    lastModified: new Date(p.dateModified ?? p.datePublished),
  }))

  return [...staticPages, ...services, ...work, ...insights]
}
