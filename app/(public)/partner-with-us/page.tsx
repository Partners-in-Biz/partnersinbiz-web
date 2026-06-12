import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { SectionHead } from '@/components/marketing/SectionHead'
import { PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'
import PartnerWithUsForm from './PartnerWithUsForm'

export const metadata: Metadata = {
  title: 'Partner with us | Real ventures, open for partners',
  description:
    'Partner in the ventures we build and run: claim your town on our area-exclusive coupon platform (I am Ballito is the live example), grow Athleet, or sell our growth services. The products are live.',
  alternates: { canonical: '/partner-with-us' },
  openGraph: {
    title: 'Partner with us — Partners in Biz ventures',
    description:
      'Live products with room for the right partners: a local commerce platform, a sports club SaaS, and a productized growth service.',
    url: `${SITE.url}/partner-with-us`,
    type: 'website',
  },
}

const HOW_IT_WORKS = [
  { title: 'Pick a venture', body: 'Choose the lane that fits your reach — a region, a sport network, or a client book.' },
  { title: 'See it live', body: 'Every product is built and running. Walk through it before you commit to anything.' },
  { title: 'Register interest', body: 'Tell us what you can unlock, with real context — links, networks, regions.' },
  { title: 'Fit review, then terms', body: 'We review fit and conflicts, then agree terms and a proper handoff.' },
]

const FIT = [
  {
    icon: 'hub',
    title: 'You bring reach',
    body: 'A region you know, a sport network you are inside, or a client book that trusts you.',
  },
  {
    icon: 'verified',
    title: 'We bring live products',
    body: 'Finished platforms and the delivery engine behind them — you are not selling a prototype.',
  },
  {
    icon: 'lock',
    title: 'Terms agreed properly',
    body: 'Everything follows a fit review. Real credentials only ever move through a secure handoff, never the public form.',
  },
]

export default function PartnerWithUsPage() {
  const featured = PARTNER_OPPORTUNITIES[0]

  return (
    <main className="relative">
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Partner with us', url: '/partner-with-us' }])} />

      {/* Hero */}
      <section className="section relative overflow-hidden pt-28 md:pt-40">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="pib-grid-bg absolute inset-0 -z-10 opacity-40" />
        <div className="container-pib">
          <Reveal eager>
            <p className="eyebrow mb-6">Partner with us</p>
          </Reveal>
          <Reveal delay={80} eager>
            <h1 className="h-display text-balance max-w-[16ch]">
              We build ventures. <em className="not-italic text-[var(--color-pib-accent)]">Own a piece of one.</em>
            </h1>
          </Reveal>
          <Reveal delay={160} eager>
            <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty leading-snug">
              Partners in Biz builds and operates its own products — an area-exclusive local commerce platform, a sports
              club SaaS, and a productized growth service. Each one has room for the right partner: businesses and
              individuals who bring an area, a network, or a client book and want to share in what it grows into.
            </p>
          </Reveal>
          <Reveal delay={240} eager>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a href="#ventures" className="btn-pib-accent">
                See the ventures
                <span className="material-symbols-outlined text-base">arrow_downward</span>
              </a>
              <Link href={featured.href} prefetch={false} className="btn-pib-secondary">
                Claim your area
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
            </div>
          </Reveal>

          {/* How it works strip */}
          <Reveal delay={320} eager>
            <div className="mt-20 md:mt-28 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-[var(--color-pib-line)] bg-[var(--color-pib-line)]">
              {HOW_IT_WORKS.map((step, index) => (
                <div key={step.title} className="bg-[var(--color-pib-surface)] p-6 md:p-7">
                  <span className="font-mono text-sm text-[var(--color-pib-accent)]">0{index + 1}</span>
                  <h2 className="mt-3 text-lg font-display text-[var(--color-pib-text)]">{step.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{step.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Fit strip */}
      <section className="section pt-0">
        <div className="container-pib grid gap-5 md:grid-cols-3">
          {FIT.map((item, index) => (
            <Reveal key={item.title} delay={index * 70}>
              <div className="bento-card h-full">
                <span
                  className="material-symbols-outlined text-[var(--color-pib-accent)]"
                  style={{ fontSize: '32px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                >
                  {item.icon}
                </span>
                <h2 className="mt-5 text-xl font-display text-[var(--color-pib-text)]">{item.title}</h2>
                <p className="mt-2 text-[var(--color-pib-text-muted)] leading-relaxed">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Ventures */}
      <section id="ventures" className="section scroll-mt-28">
        <div className="container-pib">
          <SectionHead
            eyebrow="Open ventures"
            title="Three live products. Three ways in."
            subtitle="No prototypes, no decks-in-search-of-funding. Every venture below is built, deployed, and waiting on the one thing software cannot do — people with reach."
          />

          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-7 grid gap-6">
              {PARTNER_OPPORTUNITIES.map((opportunity, i) => (
                <Reveal key={opportunity.id} delay={i * 60}>
                  <article className="bento-card p-8 md:p-10">
                    <div className="flex items-start justify-between">
                      <span
                        className="material-symbols-outlined text-[var(--color-pib-accent)]"
                        style={{ fontSize: '40px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                      >
                        {opportunity.icon}
                      </span>
                      <span className="pill text-xs">{opportunity.eyebrow}</span>
                    </div>

                    <h3 className="mt-6 text-2xl md:text-[1.75rem] font-display leading-tight text-[var(--color-pib-text)]">
                      {opportunity.venture}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-[var(--color-pib-accent)]">{opportunity.tagline}</p>
                    <p className="mt-4 text-[var(--color-pib-text-muted)] leading-relaxed text-pretty">{opportunity.summary}</p>

                    <div className="mt-6 flex flex-wrap gap-2">
                      {opportunity.stats.map((stat) => (
                        <span key={stat.label} className="pill text-xs">
                          <span className="text-[var(--color-pib-text-faint)]">{stat.label}</span>
                          {stat.value}
                        </span>
                      ))}
                    </div>

                    <div className="mt-6 hairline pt-6 grid gap-2 sm:grid-cols-3">
                      {opportunity.points.map((point) => (
                        <div key={point} className="flex items-start gap-2 text-sm text-[var(--color-pib-text)]">
                          <span className="material-symbols-outlined text-base text-[var(--color-pib-accent)]">check</span>
                          {point}
                        </div>
                      ))}
                    </div>

                    <div className="mt-8 flex flex-wrap items-center gap-3">
                      <Link href={opportunity.href} prefetch={false} className="btn-pib-accent">
                        Explore this venture
                        <span className="material-symbols-outlined text-base">arrow_forward</span>
                      </Link>
                      {opportunity.liveUrl && (
                        <a
                          href={opportunity.liveUrl}
                          target={opportunity.liveUrl.startsWith('http') ? '_blank' : undefined}
                          rel={opportunity.liveUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                          className="btn-pib-secondary"
                        >
                          {opportunity.liveLabel ?? 'See it live'}
                          <span className="material-symbols-outlined text-base">open_in_new</span>
                        </a>
                      )}
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            <div id="apply" className="scroll-mt-28 lg:col-span-5">
              <div className="lg:sticky lg:top-28">
                <PartnerWithUsForm
                  opportunity={{
                    id: featured.id,
                    title: featured.title,
                    sourcePath: '/partner-with-us',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
