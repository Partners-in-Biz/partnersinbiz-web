import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { POSTS } from '@/lib/content/posts'
import { listLivePosts } from '@/lib/content/posts-firestore'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'

export const metadata: Metadata = {
  title: 'Insights',
  description:
    'Build notes, case studies, and the occasional opinion — from the Partners in Biz workshop. Practical writing on Next.js, AI, and shipping South African software.',
  alternates: { canonical: '/insights' },
  openGraph: {
    title: 'Insights — Partners in Biz',
    description:
      'Build notes, case studies, and the occasional opinion from the Partners in Biz workshop.',
    url: `${SITE.url}/insights`,
    type: 'website',
  },
}

const CATEGORIES = ['All', 'Build Notes', 'Case Studies', 'Industry POV', 'Tools'] as const

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function InsightsIndexPage() {
  const livePosts = await listLivePosts().catch(() => [])
  const combined = [...POSTS]
  const seen = new Set(combined.map((post) => post.slug))
  for (const post of livePosts) {
    if (!seen.has(post.slug)) {
      combined.push(post)
      seen.add(post.slug)
    }
  }
  combined.sort((a, b) => Date.parse(b.dateModified ?? b.datePublished) - Date.parse(a.dateModified ?? a.datePublished))

  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Insights', url: '/insights' },
  ])

  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${SITE.url}/insights#blog`,
    name: 'Partners in Biz — Insights',
    description: 'Build notes, case studies, and industry opinions.',
    url: `${SITE.url}/insights`,
    publisher: { '@id': `${SITE.url}/#organization` },
    blogPost: combined.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      url: `${SITE.url}/insights/${p.slug}`,
      datePublished: p.datePublished,
      image: `${SITE.url}${p.cover}`,
    })),
  }

  const featured = combined[0]
  const rest = combined.slice(1)

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={blogSchema} />

      {/* Hero */}
      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <Reveal>
            <p className="eyebrow mb-6">Insights</p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="h-display text-balance max-w-5xl">
              Build notes, case studies, and the occasional opinion.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
              Practical writing from the workshop — what we learned shipping real software for real
              South African businesses. No thought-leadership, no growth hacks.
            </p>
          </Reveal>

          {/* Category chips (static) */}
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <span
                  key={c}
                  className={`pill ${c === 'All' ? 'pill-accent' : ''}`}
                >
                  {c}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Featured */}
      {featured && (
        <section className="section pt-0">
          <div className="container-pib">
            <Reveal>
              <Link
                href={`/insights/${featured.slug}`}
                className="bento-card grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden p-0 group"
              >
                <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-[420px] overflow-hidden">
                  <Image
                    src={featured.cover}
                    alt={featured.title}
                    width={1200}
                    height={800}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-8 md:p-12 flex flex-col justify-center gap-5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="pill pill-accent">{featured.category}</span>
                    <span className="text-xs font-mono text-[var(--color-pib-text-faint)]">
                      Featured
                    </span>
                  </div>
                  <h2 className="font-display text-3xl md:text-4xl leading-tight text-[var(--color-pib-text)] text-balance">
                    {featured.title}
                  </h2>
                  <p className="text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
                    {featured.description}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-[var(--color-pib-text-faint)] font-mono">
                    <span>{fmtDate(featured.datePublished)}</span>
                    <span>·</span>
                    <span>{featured.readingTime}</span>
                  </div>
                  <span className="pib-link-underline text-[var(--color-pib-accent)] text-sm font-medium inline-flex items-center gap-1.5 mt-2">
                    Read article
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </span>
                </div>
              </Link>
            </Reveal>
          </div>
        </section>
      )}

      {/* Grid */}
      {rest.length > 0 && (
        <section className="section pt-0">
          <div className="container-pib">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
              {rest.map((p, i) => (
                <Reveal key={p.slug} delay={i * 80}>
                  <Link
                    href={`/insights/${p.slug}`}
                    className="bento-card h-full p-0 overflow-hidden flex flex-col group"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <Image
                        src={p.cover}
                        alt={p.title}
                        width={800}
                        height={500}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    </div>
                    <div className="p-6 flex flex-col gap-3 flex-1">
                      <span className="pill self-start">{p.category}</span>
                      <h3 className="font-display text-xl leading-tight text-[var(--color-pib-text)] text-balance">
                        {p.title}
                      </h3>
                      <p className="text-sm text-[var(--color-pib-text-muted)] leading-relaxed text-pretty flex-1">
                        {p.description}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-pib-text-faint)] font-mono pt-2 border-t border-[var(--color-pib-line)]">
                        <span>{fmtDate(p.datePublished)}</span>
                        <span>·</span>
                        <span>{p.readingTime}</span>
                      </div>
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Newsletter CTA */}
      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="bento-card p-10 md:p-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="max-w-xl">
                <p className="eyebrow mb-3">Newsletter</p>
                <h3 className="h-display text-3xl md:text-4xl text-balance">
                  One email a month. No fluff.
                </h3>
                <p className="mt-4 text-[var(--color-pib-text-muted)] text-pretty">
                  New build notes, what worked, what broke, and the occasional tool worth keeping.
                  Unsubscribe in one click.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0 w-full md:w-auto">
                <input
                  type="email"
                  placeholder="you@company.com"
                  className="bg-[var(--color-pib-bg)] border border-[var(--color-pib-line-strong)] rounded-full px-5 py-3 text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-faint)] focus:border-[var(--color-pib-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent-soft)] transition min-w-[260px]"
                />
                <button className="btn-pib-accent" type="button">
                  Subscribe
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  )
}
