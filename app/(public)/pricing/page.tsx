import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE, TESTIMONIALS } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { SERVICE_CONTENT } from '@/lib/marketing/service-content'
import {
  Article,
  ArticleHead,
  ArticleList,
  ArticleRow,
  CtaSentence,
  Plate,
  Quote,
} from '@/components/marketing/paper/Article'
import { FAQ } from '@/components/marketing/FAQ'

const TITLE = 'Pricing'
const DESCRIPTION =
  'Real numbers in rand. A marketing site from R35,000 in 2 to 4 weeks. Web apps from R120,000. Retainers from R15,000 a month. What each price buys, and what the cheap option costs you.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: `${TITLE} | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/pricing`,
    type: 'website',
  },
}

const ZAR = (n: number) => `R${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`

const SITE_TIER = SERVICE_CONTENT['web-development']
const APP_TIER = SERVICE_CONTENT['web-applications']
const BESPOKE_TIER = SERVICE_CONTENT['bespoke-builds']

const COMPARISON = [
  { row: 'Price', cheap: 'R6,000 to R15,000', ours: 'From R35,000, fixed' },
  { row: 'Design', cheap: 'A theme with your logo dropped in', ours: 'Designed and written for your business' },
  { row: 'Search', cheap: 'Whatever the theme ships with', ours: 'Schema, sitemap, and pages Google can read' },
  { row: 'Leads', cheap: 'A contact form to an inbox nobody checks', ours: 'Enquiries to your WhatsApp, with analytics' },
  { row: 'Speed', cheap: 'Plugins stacked until it crawls', ours: 'Fast on a phone. AHS Law loads in 1.4 seconds' },
  { row: 'Ownership', cheap: 'Their platform, their monthly fee', ours: 'Your GitHub, your Vercel, your domain' },
  { row: 'After launch', cheap: 'A ticket queue', ours: 'A 30-day warranty and one person on WhatsApp' },
] as const

const RETAINERS = [
  { name: 'Lite', price: 15000, blurb: 'eight hours of development a month, plus hosting and monitoring' },
  { name: 'Growth', price: 35000, blurb: 'twenty hours, roadmap reviews and growth experiments' },
  { name: 'Embedded', price: 75000, blurb: 'forty hours, on-call, and a weekly meeting' },
] as const

const ADDONS = [
  { name: 'Performance audit', price: ZAR(8000) },
  { name: 'SEO sprint', price: ZAR(12000) },
  { name: 'Brand identity', price: `from ${ZAR(18000)}` },
  { name: 'AI feature build-in', price: `from ${ZAR(25000)}` },
  { name: 'Migration to a modern stack', price: `from ${ZAR(28000)}` },
] as const

const PRICING_FAQ = [
  {
    q: 'Are these starting prices?',
    a: 'Yes. The "from" number assumes a clean brief and standard scope. Most projects land between the start and twice it. You get a fixed-scope quote within three working days, so there is never a surprise.',
  },
  {
    q: 'How do payments work?',
    a: 'For a marketing site, half to start and half at launch. For larger builds, 40% to start, 30% at design sign-off, 30% at launch. Bespoke work runs on monthly milestones. EFT for South African clients, PayPal in USD or EUR for international ones.',
  },
  {
    q: 'Why no Stripe for invoices?',
    a: 'For South African clients EFT is free, instant, and what businesses already use. Stripe adds 3.5% plus R3 a transaction for no benefit on a R120,000 invoice. We will build Stripe into your product if you sell to consumers; we just do not use it to bill you.',
  },
  {
    q: 'What is not included?',
    a: 'Hosting (Vercel, about $20 a month), the database (Firebase or Supabase, free or pay as you go), your domain, and any third-party APIs you choose are billed to your own accounts. We do not mark them up.',
  },
  {
    q: 'What does it cost to run?',
    a: 'Most marketing sites run for under R500 a month. Web apps with auth and a database sit between R1,000 and R5,000 a month and scale with use. We design for cost from day one.',
  },
  {
    q: 'Can we do equity or revenue share?',
    a: 'For bespoke builds, sometimes. We take equity in roughly one in five of those projects. The bar is real founders, real traction, and a problem we want to solve. Equity sits on top of a discounted cash rate, never instead of one.',
  },
]

export default function PricingPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Pricing', url: '/pricing' },
  ])
  const offers = [SITE_TIER, APP_TIER].map((tier) => ({
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: tier.headline,
    url: `${SITE.url}/pricing`,
    priceCurrency: 'ZAR',
    price: tier.price.amount,
    priceSpecification: { '@type': 'PriceSpecification', minPrice: tier.price.amount, priceCurrency: 'ZAR' },
    availability: 'https://schema.org/InStock',
    seller: { '@id': `${SITE.url}/#organization` },
  }))
  const testimonial = TESTIMONIALS[1]

  return (
    <Article>
      <JsonLd data={breadcrumb} />
      <JsonLd data={faqSchema(PRICING_FAQ)} />
      {offers.map((o) => (
        <JsonLd key={o.name} data={o} />
      ))}

      <ArticleHead
        kicker="Pricing"
        title="Real numbers. What each one buys."
        lede="Three shapes cover most of the work. The price is on the page because you should be able to decide before the call, not after it."
        plate={<Plate src={WORK_SHOTS.ahsLaw.src} alt={WORK_SHOTS.ahsLaw.alt} caption="AHS Law. A marketing site and a client portal." wide priority />}
      />

      <ArticleRow
        title="A marketing site"
        aside={
          <>
            <p className="sc-article__price">{SITE_TIER.price.label}</p>
            <p className="sc-body">{SITE_TIER.price.terms}</p>
            <Quote quote={testimonial.quote} by={testimonial.role} />
          </>
        }
      >
        <p>{SITE_TIER.lede}</p>
        <ArticleList items={SITE_TIER.price.includes} />
        <p>{SITE_TIER.price.contrast}</p>
        <CtaSentence lead="Twenty minutes is enough to know if this is the right shape for you." />
      </ArticleRow>

      <ArticleRow title="What the R8,000 site costs you">
        <p>
          The cheap site is not cheap. It is a template with your logo, a form to an inbox, no search work, and a monthly
          fee to a platform you do not control. Here is the honest comparison.
        </p>
        <table className="sc-article__table">
          <thead>
            <tr>
              <th scope="col"> </th>
              <th scope="col">The R8,000 site</th>
              <th scope="col">Ours</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((r) => (
              <tr key={r.row}>
                <th scope="row">{r.row}</th>
                <td>{r.cheap}</td>
                <td>{r.ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ArticleRow>

      <ArticleRow
        title="A web application"
        flip
        aside={
          <>
            <p className="sc-article__price">{APP_TIER.price.label}</p>
            <p className="sc-body">{APP_TIER.price.terms}</p>
            <p className="sc-body">
              <Link href="/services/web-applications" prefetch={false} className="sc-link">
                What ships and how it runs
              </Link>
            </p>
          </>
        }
      >
        <p>{APP_TIER.lede}</p>
        <ArticleList items={APP_TIER.price.includes} />
        <p>{APP_TIER.price.contrast}</p>
      </ArticleRow>

      <ArticleRow
        title="Bespoke and ongoing"
        aside={
          <>
            <p className="sc-tiny">One-off extras</p>
            <ArticleList items={ADDONS.map((a) => `${a.name}, ${a.price}`)} />
          </>
        }
      >
        <p>
          <strong>Bespoke builds</strong> are quoted on the work, not a price card. A discovery sprint starts at{' '}
          {ZAR(BESPOKE_TIER.price.amount ?? 85000)}. Fractional CTO from {ZAR(45000)} a month. Equity-style partnerships considered.
        </p>
        <p>
          <strong>Retainers</strong> keep the work moving after launch and you can cancel any month.{' '}
          {RETAINERS.map((r) => `${r.name} is ${ZAR(r.price)} a month for ${r.blurb}.`).join(' ')}
        </p>
        <p>
          Every web application and bespoke build ships with{' '}
          <Link href="/properties" prefetch={false} className="sc-link">
            Properties
          </Link>
          , our runtime control plane: remote config, feature flags, a kill switch, and per-site analytics, all without a
          redeploy.
        </p>
        <p className="sc-tiny">
          Prices in rand. USD and EUR on request. EFT is free for South African clients; PayPal for international clients
          at 3.5%.
        </p>
      </ArticleRow>

      <ArticleRow title="The questions every client asks">
        <FAQ items={PRICING_FAQ} />
        <CtaSentence lead="Tell us what you are building and we will tell you what it costs." />
      </ArticleRow>
    </Article>
  )
}
