import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE, TESTIMONIALS } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import StartProjectForm from './StartProjectForm'
import { marketBookHref, marketFromId } from '@/lib/seo/market-offers'

export const metadata: Metadata = {
  title: 'Start a project',
  description:
    'Tell us what you are building. Four quick questions, ninety seconds. We reply within one business day.',
  alternates: { canonical: '/start-a-project' },
  openGraph: {
    title: 'Start a project — Partners in Biz',
    description:
      'Four quick questions. Ninety seconds. We reply within one business day with a 3-paragraph summary.',
    url: `${SITE.url}/start-a-project`,
    type: 'website',
  },
}

const NEXT_STEPS = [
  'We reply within one business day.',
  'We send a 3-paragraph summary of what we heard.',
  'We book a 20-min intro call.',
  'You get a fixed-scope estimate within 3 working days.',
]

const TRUST = [
  'EFT, PayPal, international cards',
  'Reply within 1 business day',
  'Pretoria-based, working globally',
  '100% of clients still operating',
]

export default async function StartProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; offer?: string }>
}) {
  const params = await searchParams
  const market = marketFromId(params.market)
  const trust = market
    ? [
        `${market.currencyCode} · Stripe · half to start`,
        'Reply within 1 business day',
        market.overlapShort,
        'You own the repo on day one',
      ]
    : TRUST
  const bookHref = market ? marketBookHref(market.id) : SITE.cal.url
  const waLink = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    ...(market ? [{ name: `${market.regionLabel} Offer`, url: market.path }] : []),
    { name: 'Start a project', url: '/start-a-project' },
  ])
  const contactPoint = {
    '@context': 'https://schema.org',
    '@type': 'ContactPoint',
    contactType: 'sales',
    email: SITE.email,
    telephone: SITE.phone,
    areaServed: market ? [...market.countries] : ['ZA', 'GB', 'US', 'EU', 'AU'],
    availableLanguage: ['English'],
    url: `${SITE.url}/start-a-project`,
  }
  const testimonial = TESTIMONIALS[0]

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={contactPoint} />

      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
            <div className="lg:col-span-7 order-2 lg:order-1">
              <div className="lg:sticky lg:top-28">
                <StartProjectForm />
              </div>
            </div>

            <div className="lg:col-span-5 order-1 lg:order-2">
              <Reveal>
                <p className="eyebrow mb-6">{market ? 'The 4-Week Site' : 'Start a project'}</p>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="h-display text-balance" style={{ fontSize: 'clamp(2.5rem, 5vw, 4.5rem)' }}>
                  {market ? 'Tell us about the site.' : <>Tell us what you&rsquo;re building.</>}
                </h1>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 text-lg text-[var(--color-pib-text-muted)] text-pretty">
                  {market
                    ? `Four quick questions. Ninety seconds. We reply within one business day — ${market.currencyCode}, Stripe, repo yours.`
                    : 'Four quick questions. Ninety seconds. We reply within one business day.'}
                </p>
              </Reveal>

              <Reveal delay={240}>
                <div className="mt-10 bento-card p-6">
                  <p className="eyebrow mb-4">What happens next</p>
                  <ol className="space-y-3">
                    {NEXT_STEPS.map((s, i) => (
                      <li key={s} className="flex gap-3 text-sm text-[var(--color-pib-text)]">
                        <span className="font-mono text-[var(--color-pib-accent)] shrink-0">
                          0{i + 1}
                        </span>
                        <span className="text-pretty">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>

              <Reveal delay={320}>
                <div className="mt-6 bento-card p-6">
                  <p className="eyebrow mb-4">Prefer something else?</p>
                  <ul className="space-y-3">
                    <li>
                      <a
                        href={`mailto:${SITE.email}`}
                        className="flex items-center gap-3 text-sm text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)] transition"
                      >
                        <span className="material-symbols-outlined text-base">mail</span>
                        {SITE.email}
                      </a>
                    </li>
                    <li>
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 text-sm text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)] transition"
                      >
                        <span className="material-symbols-outlined text-base">chat</span>
                        WhatsApp us
                      </a>
                    </li>
                    <li>
                      <Link
                        href={bookHref}
                        prefetch={false}
                        className="flex items-center gap-3 text-sm text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)] transition"
                      >
                        <span className="material-symbols-outlined text-base">event</span>
                        Book a 20-min call
                      </Link>
                    </li>
                  </ul>
                </div>
              </Reveal>

              <Reveal delay={400}>
                <figure className="mt-6 bento-card p-6">
                  <span
                    className="material-symbols-outlined text-[var(--color-pib-accent)] mb-3 block"
                    style={{ fontSize: '28px' }}
                  >
                    format_quote
                  </span>
                  <blockquote className="font-display text-xl leading-snug text-[var(--color-pib-text)] text-pretty">
                    &ldquo;{testimonial.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-4 text-sm text-[var(--color-pib-text-muted)]">
                    <span className="text-[var(--color-pib-text)]">{testimonial.author}</span>
                    {' · '}
                    {testimonial.role}
                  </figcaption>
                </figure>
              </Reveal>

              <Reveal delay={480}>
                <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {trust.map((t) => (
                    <li
                      key={t}
                      className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]"
                    >
                      <span className="material-symbols-outlined text-sm text-[var(--color-pib-accent)]">
                        check
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
