import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'

export const metadata: Metadata = {
  title: 'The 4-Week Site — $9,500',
  description:
    'A production Next.js site that gets you clients. $9,500. Yours in 28 days. You own the GitHub, Vercel, and domain. Half on Stripe to start, half on launch.',
  alternates: { canonical: '/us' },
  openGraph: {
    title: 'The 4-Week Site — $9,500 | Partners in Biz',
    description:
      'Production Next.js in four weeks. You own the repo. Half on Stripe to start, half on launch.',
    url: `${SITE.url}/us`,
    type: 'website',
    images: ['/og/default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The 4-Week Site — $9,500',
    description: 'A site that gets you clients. Yours in 28 days.',
  },
}

const START_HREF = '/start-a-project?offer=4-week-site&market=us'
const BOOK_HREF = '/book-a-call?market=us'

const INCLUDED = [
  'Custom Next.js site — not a template',
  'Sub-2s load. Built to rank.',
  'Real lead capture, wired to your inbox or CRM',
  'Analytics live on day one',
  'Your repo, your hosting, your keys',
  'One person. WhatsApp the whole time. Overlap 8am–12pm ET.',
] as const

const EXCLUDED = [
  'Discovery theatre',
  'Account managers',
  'Monthly platform fees',
  "A site you don't own",
] as const

const PROOF = [
  {
    client: 'Athleet',
    line: 'Club OS in under 4 weeks. 500+ athletes.',
    href: '/work/athleet',
    cover: '/images/case-athleet-cover.jpg',
  },
  {
    client: 'AHS Law',
    line: '#1 on Google for their terms. 2× inbound.',
    href: '/work/ahs-law',
    cover: '/images/case-ahs-law-cover.jpg',
  },
  {
    client: 'Velox',
    line: 'In the App Store and Play Store.',
    href: '/work/velox',
    cover: '/images/case-velox-cover.png',
  },
] as const

function CtaRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Link href={START_HREF} prefetch={false} className="btn-pib-accent">
        Start a project
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          arrow_outward
        </span>
      </Link>
      <Link href={BOOK_HREF} prefetch={false} className="btn-pib-secondary">
        Book 20 minutes
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          calendar_month
        </span>
      </Link>
    </div>
  )
}

export default function UsOfferPage() {
  const offerSchema = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: 'The 4-Week Site',
    description:
      'Production Next.js marketing site shipped in 28 days. Client owns GitHub, Vercel, and domain.',
    price: '9500',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    url: `${SITE.url}/us`,
    seller: {
      '@type': 'Organization',
      name: SITE.name,
      url: SITE.url,
    },
  }

  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'US Offer', url: '/us' }])} />
      <JsonLd data={offerSchema} />

      {/* HERO — one composition: brand, offer, price, CTAs */}
      <section className="relative pt-28 md:pt-40 pb-20 md:pb-28 overflow-hidden">
        <div className="absolute inset-0 pib-mesh pointer-events-none" />
        <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-40" />

        <div className="container-pib relative max-w-4xl">
          <Reveal eager>
            <p className="eyebrow mb-6">Partners in Biz · United States</p>
          </Reveal>

          <Reveal delay={60} eager>
            <h1 className="h-display text-balance max-w-[16ch]">The 4-Week Site</h1>
          </Reveal>

          <Reveal delay={120} eager>
            <p className="mt-6 text-xl md:text-2xl text-[var(--color-pib-text-muted)] max-w-2xl text-pretty leading-snug">
              A site that gets you clients. <span className="text-[var(--color-pib-text)]">$9,500.</span> Yours
              in 28 days.
            </p>
          </Reveal>

          <Reveal delay={180} eager>
            <p className="mt-6 text-base md:text-lg text-[var(--color-pib-text-muted)] max-w-2xl text-pretty leading-relaxed">
              Most agencies take a quarter and hand you a theme. We ship production Next.js in four weeks. You
              own the GitHub, the Vercel, the domain. Fire us the next day and nothing breaks.
            </p>
          </Reveal>

          <Reveal delay={240} eager>
            <p className="mt-8 font-display text-3xl md:text-4xl text-[var(--color-pib-text)] tracking-tight">
              $9,500
            </p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Half on Stripe to start. Half on launch.
            </p>
          </Reveal>

          <Reveal delay={300} eager>
            <CtaRow className="mt-10" />
          </Reveal>
        </div>
      </section>

      {/* IN / OUT */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib grid md:grid-cols-2 gap-12 md:gap-16 max-w-5xl">
          <Reveal>
            <h2 className="eyebrow mb-6">What&rsquo;s in</h2>
            <ul className="space-y-4">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-3 text-[var(--color-pib-text)] text-pretty">
                  <span className="material-symbols-outlined text-[var(--color-pib-accent)] shrink-0 mt-0.5" aria-hidden="true">
                    check
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="eyebrow mb-6">What&rsquo;s not</h2>
            <ul className="space-y-4">
              {EXCLUDED.map((item) => (
                <li key={item} className="flex gap-3 text-[var(--color-pib-text-muted)] text-pretty">
                  <span className="material-symbols-outlined shrink-0 mt-0.5" aria-hidden="true">
                    close
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* PROOF */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib max-w-5xl">
          <Reveal>
            <h2 className="h-display text-balance mb-12 md:mb-16">Proof</h2>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {PROOF.map((p, i) => (
              <Reveal key={p.client} delay={i * 80}>
                <Link href={p.href} prefetch={false} className="group block">
                  <div className="relative aspect-[4/3] overflow-hidden mb-5">
                    <Image
                      src={p.cover}
                      alt={`${p.client} case study`}
                      fill
                      sizes="(min-width: 768px) 30vw, 100vw"
                      className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-700"
                    />
                  </div>
                  <p className="font-display text-2xl mb-2 group-hover:text-[var(--color-pib-accent)] transition-colors">
                    {p.client}
                  </p>
                  <p className="text-sm text-[var(--color-pib-text-muted)] text-pretty">{p.line}</p>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FIT */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib grid md:grid-cols-2 gap-12 md:gap-16 max-w-5xl">
          <Reveal>
            <h2 className="eyebrow mb-5">Who this is for</h2>
            <p className="text-lg text-[var(--color-pib-text)] text-pretty leading-relaxed">
              US founder-led firms. Law, clinics, coaches, B2B services. You have demand and a dead site.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="eyebrow mb-5">Who this is not for</h2>
            <p className="text-lg text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
              Anyone who wants a $1,500 Wix. Anyone who needs a 9-month committee.
            </p>
          </Reveal>
        </div>
      </section>

      {/* AFTER */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib max-w-3xl">
          <Reveal>
            <h2 className="h-display text-balance mb-8">After the site</h2>
          </Reveal>
          <Reveal delay={60}>
            <div className="space-y-6 text-lg text-[var(--color-pib-text-muted)] leading-relaxed">
              <p className="text-pretty">
                Need a portal or an app?{' '}
                <span className="text-[var(--color-pib-text)]">From $35,000.</span>
              </p>
              <p className="text-pretty">
                Want us to keep shipping?{' '}
                <span className="text-[var(--color-pib-text)]">$2,500/month.</span> Cancel any month.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CLOSE */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib max-w-3xl text-center">
          <Reveal>
            <p className="font-display text-3xl md:text-5xl text-balance leading-tight">
              One price. One promise. 28 days.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <div className="mt-10 flex justify-center">
              <Link href={START_HREF} prefetch={false} className="btn-pib-accent">
                Start a project
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  arrow_outward
                </span>
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
