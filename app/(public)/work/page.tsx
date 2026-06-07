import type { Metadata } from 'next'
import Link from 'next/link'
import { CASE_STUDIES, SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { WorkGrid } from './WorkGrid'

export const metadata: Metadata = {
  title: 'Selected work — Case studies | Partners in Biz',
  description:
    'Real builds, live codebases, and shipped products from Partners in Biz across mobile apps, web apps, sport-tech, aviation, legal, and EdTech.',
  alternates: { canonical: '/work' },
  openGraph: {
    title: 'Selected work — Case studies | Partners in Biz',
    description:
      'Real builds, live codebases, and shipped products from Partners in Biz.',
    url: `${SITE.url}/work`,
    type: 'website',
  },
}

export default function WorkIndexPage() {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: CASE_STUDIES.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE.url}${c.href}`,
      name: c.headline,
    })),
  }

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: '/' },
          { name: 'Work', url: '/work' },
        ])}
      />
      <JsonLd data={itemList} />

      <main className="relative">
        {/* Hero */}
        <section className="section relative pt-40 pb-16 md:pb-24 overflow-hidden">
          <div className="absolute inset-0 pib-mesh opacity-70 pointer-events-none" />
          <div className="absolute inset-0 pib-grid-bg opacity-40 pointer-events-none" />
          <div className="container-pib relative">
            <Reveal>
              <p className="eyebrow mb-6">Selected work</p>
              <h1 className="h-display text-balance max-w-5xl">
                Real builds.{' '}
                <span className="italic text-[var(--color-pib-text-muted)]">Real outcomes.</span>{' '}
                Real names.
              </h1>
              <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
                A small body of work we are proud of — from sports clubs and law firms to aviation
                loyalty platforms, mobile apps, and owned EdTech products. Each one is a real
                codebase and a real shipped surface we can point at.
              </p>
            </Reveal>

            {/* Status strip */}
            <Reveal delay={140}>
              <div className="mt-12 inline-flex flex-wrap items-center gap-4 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 backdrop-blur px-5 py-3">
                <span className="relative inline-flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inset-0 rounded-full bg-[var(--color-pib-success)] opacity-70 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-pib-success)]" />
                  </span>
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text)]">
                    Currently building
                  </span>
                </span>
                <span className="text-sm text-[var(--color-pib-text-muted)]">
                  Client work, internal products, and app builds in one portfolio
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Grid */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib">
            <WorkGrid />
          </div>
        </section>

        {/* CTA band */}
        <section className="pb-32">
          <div className="container-pib">
            <Reveal>
              <div className="bento-card relative overflow-hidden p-10 md:p-16">
                <div className="absolute inset-0 pib-mesh opacity-50 pointer-events-none" />
                <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                  <div className="max-w-2xl">
                    <p className="eyebrow mb-4">What&apos;s next</p>
                    <h2 className="h-display text-balance">Want yours next?</h2>
                    <p className="mt-5 text-lg text-[var(--color-pib-text-muted)] text-pretty">
                      We take on a small number of new builds each quarter. If you have a real
                      problem worth solving, let&apos;s talk.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link href="/start-a-project" className="btn-pib-accent">
                      Start a project
                      <span className="material-symbols-outlined text-base">arrow_forward</span>
                    </Link>
                    <Link href={SITE.cal.url} className="btn-pib-secondary">
                      Book a call
                      <span className="material-symbols-outlined text-base">arrow_outward</span>
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </>
  )
}
