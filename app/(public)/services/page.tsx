import type { Metadata } from 'next'
import Link from 'next/link'
import { SERVICES, SITE, FAQ_HOMEPAGE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, serviceSchema } from '@/lib/seo/schema'
import { SectionHead } from '@/components/marketing/SectionHead'
import { Reveal } from '@/components/marketing/Reveal'
import { FAQ } from '@/components/marketing/FAQ'

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Six ways we work with you — marketing websites, custom web apps, mobile, AI agents, growth systems, and bespoke builds. Real production code. Shipped weekly.',
  alternates: { canonical: '/services' },
  openGraph: {
    title: 'Services — Partners in Biz',
    description:
      'Marketing sites, custom platforms, AI agents, mobile apps, growth automation and bespoke builds — engineered for South African SMEs.',
    url: `${SITE.url}/services`,
    type: 'website',
  },
}

// Visual rhythm: which cards get more space.
const FEATURED_SLUGS = new Set(['web-applications', 'ai-integration'])

const ENGAGEMENT_MODES = [
  {
    name: 'Project',
    icon: 'rocket_launch',
    tagline: 'Fixed scope. Fixed price.',
    body:
      'A defined deliverable shipped end-to-end — usually a website, an MVP, or a discrete feature. Quoted in three business days, delivered against a Linear board you can read.',
    bullets: ['3-day quote', 'Vercel previews from week one', 'Code in your GitHub at the end'],
  },
  {
    name: 'Retainer',
    icon: 'event_repeat',
    tagline: 'Monthly hours. Compounding output.',
    body:
      'A standing block of senior engineering time each month — for product iteration, growth experiments, monitoring, and the work that never quite fits a project shape.',
    bullets: ['From R15 000 / month', '8–40 hours of build', 'Hosting, monitoring, security'],
  },
  {
    name: 'Advisory',
    icon: 'psychology',
    tagline: 'Architecture-level partnership.',
    body:
      'Board-style engagement for founders and CTOs — architecture review, AI strategy, hiring decisions, and a senior outside view on what you are building.',
    bullets: ['Monthly working sessions', 'Async review of PRs and specs', 'Equity-style options'],
  },
]

export default function ServicesIndexPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Services', url: '/services' },
  ])

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      {SERVICES.map((s) => (
        <JsonLd
          key={s.slug}
          data={serviceSchema({
            slug: s.slug,
            name: s.name,
            description: s.outcome,
          })}
        />
      ))}

      {/* Hero */}
      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <Reveal>
            <p className="eyebrow mb-6">Services</p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="h-display text-balance max-w-5xl">Six ways we work with you.</h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
              We build the kind of software your business deserves — from marketing sites that
              rank on day one, to custom platforms that replace a stack of spreadsheets. Pick the
              shape that fits, or let us scope it together.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/start-a-project" className="btn-pib-primary">
                Start a project
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href="/work" className="btn-pib-secondary">
                See our work
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Bento grid */}
      <section className="section pt-0">
        <div className="container-pib">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 auto-rows-[1fr]">
            {SERVICES.map((service, i) => {
              const featured = FEATURED_SLUGS.has(service.slug)
              return (
                <Reveal
                  key={service.slug}
                  delay={i * 60}
                  className={featured ? 'md:col-span-2' : ''}
                >
                  <Link
                    href={`/services/${service.slug}`}
                    className="bento-card h-full flex flex-col gap-6 p-8 md:p-10 group"
                  >
                    <div className="flex items-start justify-between">
                      <span
                        className="material-symbols-outlined text-[var(--color-pib-accent)]"
                        style={{ fontSize: '40px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                      >
                        {service.icon}
                      </span>
                      <span className="material-symbols-outlined text-[var(--color-pib-text-faint)] group-hover:text-[var(--color-pib-text)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all">
                        arrow_outward
                      </span>
                    </div>

                    <div className="flex-1">
                      <h2 className="text-2xl md:text-[1.75rem] font-display leading-tight text-[var(--color-pib-text)] text-balance">
                        {service.name}
                      </h2>
                      <p className="mt-2 text-[var(--color-pib-text-muted)]">{service.short}</p>
                      <p className="mt-5 text-[var(--color-pib-text)] text-pretty leading-relaxed">
                        {service.outcome}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      {service.keywords.map((k) => (
                        <span key={k} className="pill text-xs">
                          {k}
                        </span>
                      ))}
                    </div>

                    <div className="pib-link-underline text-sm font-medium text-[var(--color-pib-accent)] inline-flex items-center gap-1.5 mt-2">
                      Learn more
                      <span className="material-symbols-outlined text-base">arrow_forward</span>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* How we engage */}
      <section className="section">
        <div className="container-pib">
          <SectionHead
            eyebrow="How we engage"
            title="Three shapes. Same standard of work."
            subtitle="Whether it is a single project or a multi-year partnership, the engineering bar is identical. Pick the engagement that matches the work — not the other way around."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
            {ENGAGEMENT_MODES.map((mode, i) => (
              <Reveal key={mode.name} delay={i * 80}>
                <div className="bento-card h-full p-8 md:p-10 flex flex-col gap-6">
                  <span
                    className="material-symbols-outlined text-[var(--color-pib-accent)]"
                    style={{ fontSize: '32px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                  >
                    {mode.icon}
                  </span>
                  <div>
                    <h3 className="font-display text-2xl text-[var(--color-pib-text)]">
                      {mode.name}
                    </h3>
                    <p className="mt-1 text-sm uppercase tracking-widest text-[var(--color-pib-accent)]/80">
                      {mode.tagline}
                    </p>
                  </div>
                  <p className="text-[var(--color-pib-text-muted)] text-pretty leading-relaxed flex-1">
                    {mode.body}
                  </p>
                  <ul className="space-y-2 pt-2 border-t border-[var(--color-pib-line)]">
                    {mode.bullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-sm text-[var(--color-pib-text)]"
                      >
                        <span className="material-symbols-outlined text-base text-[var(--color-pib-accent)] mt-0.5">
                          check
                        </span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Mid-page CTA strip */}
      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="bento-card p-10 md:p-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="max-w-xl">
                <p className="eyebrow mb-3">Not sure which fits?</p>
                <h3 className="h-display text-3xl md:text-4xl text-balance">
                  Let&rsquo;s scope it together.
                </h3>
                <p className="mt-4 text-[var(--color-pib-text-muted)] text-pretty">
                  A 20-minute call. We tell you what shape the work should be — and what it
                  actually costs. No discovery deck, no nine-month runway.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <Link href="/start-a-project" className="btn-pib-primary">
                  Start a project
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
                <Link href="/properties" className="btn-pib-secondary">
                  Partners in Biz Properties
                </Link>
                <a href={SITE.cal.url} className="btn-pib-secondary" target="_blank" rel="noreferrer">
                  Book a call
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="container-pib">
          <SectionHead
            eyebrow="FAQ"
            title="The questions everyone asks."
            subtitle="If yours is not here, write to us. We answer every email."
          />
          <FAQ items={FAQ_HOMEPAGE} />
        </div>
      </section>
    </main>
  )
}
