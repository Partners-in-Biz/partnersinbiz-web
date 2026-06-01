import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { CASE_STUDIES, SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { FAQ } from '@/components/marketing/FAQ'
import GautengGrowthAuditForm from './GautengGrowthAuditForm'

export const metadata: Metadata = {
  title: 'Gauteng Growth Audit for Small Businesses',
  description:
    'Get a free growth audit for your Gauteng small business. Partners in Biz reviews your website, local SEO, and social media, then shows where enquiries are leaking.',
  alternates: { canonical: '/gauteng-growth-audit' },
  openGraph: {
    title: 'Gauteng Growth Audit for Small Businesses',
    description:
      'A free audit for Gauteng SMEs that checks your website, local SEO, and social media lead paths.',
    url: `${SITE.url}/gauteng-growth-audit`,
    type: 'website',
    images: ['/og/default.png'],
  },
}

const PROOF_POINTS = [
  'Pretoria-based',
  'Built for Gauteng SMEs',
  'Website + SEO + social in one sprint',
  'Reply within one business day',
]

const LEAKS = [
  'Your website gets visits, but too few WhatsApp messages or form leads.',
  'Google searches send ready buyers to competitors who simply look stronger online.',
  'Social media takes effort, but it does not create a reliable enquiry path.',
  'Referrals still matter, but they are not predictable enough to scale.',
  'You cannot tell which marketing activity is actually working.',
]

const ENGINE = [
  {
    icon: 'language',
    title: 'Website that converts',
    body:
      'Fast pages, clear offers, local proof, strong calls to action, and analytics that show where prospects drop off.',
  },
  {
    icon: 'search',
    title: '90-day SEO sprint',
    body:
      'Technical foundations, local keyword targeting, content, indexing checks, and measurement instead of guesswork.',
  },
  {
    icon: 'campaign',
    title: 'Social that builds demand',
    body:
      'Consistent posts, proof, repurposed content, and calls to action that support search and retargeting.',
  },
]

const ROADMAP = [
  {
    label: 'Days 1-30',
    title: 'Foundation',
    body:
      'Audit, positioning, website structure, tracking, technical SEO, and the first conversion fixes.',
  },
  {
    label: 'Days 31-60',
    title: 'Momentum',
    body:
      'SEO content, local search pages, Google Business Profile guidance, and a social content engine.',
  },
  {
    label: 'Days 61-90',
    title: 'Compounding',
    body:
      'Optimise from data, strengthen proof, publish authority content, and improve lead paths.',
  },
]

const AREAS = ['Pretoria', 'Johannesburg', 'Centurion', 'Midrand', 'East Rand', 'West Rand']

const NEXT_STEPS = [
  'We review the visible parts of your website, Google presence, and social media.',
  'We identify the biggest enquiry leaks.',
  'We send a plain-language audit summary.',
  'If there is a fit, we map the 90-day sprint.',
]

const FAQS = [
  {
    q: 'Is the Gauteng Growth Audit really free?',
    a: 'Yes. We review the visible parts of your website, Google presence, and social media, then send the first practical fixes we would make. If there is a fit, we will explain the 90-day sprint after the audit.',
  },
  {
    q: 'Do I need a new website?',
    a: 'Not always. Some businesses need a better lead path, faster pages, stronger proof, or clearer local SEO before a rebuild makes sense. The audit separates quick fixes from rebuild work.',
  },
  {
    q: 'What if someone already posts on social media for us?',
    a: 'That can help. We look at whether your posts support trust, local demand, proof, and enquiries. If posting is happening without a measurable path to leads, the system needs tightening.',
  },
  {
    q: 'How soon can SEO create leads?',
    a: 'SEO compounds over weeks and months. The first 30 days focus on foundations and conversion leaks, days 31-60 build content and local visibility, and days 61-90 optimise from real signals.',
  },
  {
    q: 'Do you only work with Gauteng businesses?',
    a: 'Partners in Biz works beyond Gauteng, but this campaign is built for Gauteng small businesses because local proof, local search intent, and practical owner-led marketing matter here.',
  },
  {
    q: 'What happens after the 90 days?',
    a: 'The sprint becomes a compounding rhythm: keep the technical base healthy, publish useful content, improve social proof, and optimise lead paths from data instead of guessing.',
  },
]

const CASES = CASE_STUDIES.filter((study) => ['ahs-law', 'scrolledbrain'].includes(study.slug))

export default function GautengGrowthAuditPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Gauteng Growth Audit', url: '/gauteng-growth-audit' },
  ])

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={faqSchema(FAQS)} />

      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-30" />
        <div className="container-pib relative grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <Reveal eager>
              <p className="eyebrow mb-6">Free Gauteng Growth Audit</p>
              <h1 className="h-display max-w-5xl text-balance">
                Gauteng small businesses deserve more than a website that just sits there.
              </h1>
              <p className="mt-6 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
                We build your website, sharpen your Google visibility, and turn social media into
                a lead engine over 90 days. Start with a free growth audit so you can see exactly
                where enquiries are leaking.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#audit-form" className="btn-pib-accent">
                  Get my free growth audit
                  <span className="material-symbols-outlined text-base">arrow_downward</span>
                </a>
                <a href="#ninety-day-plan" className="btn-pib-secondary">
                  See the 90-day plan
                </a>
              </div>
              <ul className="mt-8 grid gap-2 sm:grid-cols-2">
                {PROOF_POINTS.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
                    <span className="material-symbols-outlined text-base text-[var(--color-pib-accent)]">
                      check
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={160}>
              <div className="mt-10 bento-card p-6 md:p-8">
                <p className="eyebrow mb-3">The real problem</p>
                <h2 className="font-display text-3xl leading-tight text-[var(--color-pib-text)] text-balance">
                  Your business may be strong offline, but online it can still look quiet,
                  outdated, or hard to trust.
                </h2>
                <div className="mt-6 grid gap-3">
                  {LEAKS.map((leak) => (
                    <div key={leak} className="flex gap-3 text-sm text-[var(--color-pib-text-muted)]">
                      <span className="material-symbols-outlined mt-0.5 text-base text-[var(--color-pib-accent)]">
                        warning
                      </span>
                      <span>{leak}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

          <div id="audit-form" className="lg:col-span-5 lg:sticky lg:top-28">
            <GautengGrowthAuditForm />
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="grid gap-4 md:grid-cols-3">
              {ENGINE.map((item) => (
                <div key={item.title} className="bento-card p-6 md:p-8">
                  <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">
                    {item.icon}
                  </span>
                  <h2 className="mt-6 font-display text-2xl text-[var(--color-pib-text)]">
                    {item.title}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="ninety-day-plan" className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="mb-8 max-w-3xl">
              <p className="eyebrow mb-4">The 90-day sprint</p>
              <h2 className="h-display text-4xl md:text-5xl text-balance">
                Website, SEO, and social working as one system.
              </h2>
              <p className="mt-5 text-[var(--color-pib-text-muted)] text-pretty">
                Most owners are sold disconnected activity. We use the audit to find the leaks,
                then build the sprint around the path from attention to enquiry.
              </p>
            </div>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {ROADMAP.map((item, index) => (
              <Reveal key={item.label} delay={index * 80}>
                <div className="bento-card h-full p-6 md:p-8">
                  <p className="eyebrow mb-4">{item.label}</p>
                  <h3 className="font-display text-2xl text-[var(--color-pib-text)]">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
                    {item.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib grid gap-5 lg:grid-cols-12 lg:items-stretch">
          <Reveal className="lg:col-span-5">
            <div className="bento-card h-full p-8 md:p-10">
              <p className="eyebrow mb-4">Local relevance</p>
              <h2 className="font-display text-3xl md:text-4xl leading-tight text-[var(--color-pib-text)] text-balance">
                Built for Gauteng business hubs, not generic marketing theory.
              </h2>
              <p className="mt-5 text-[var(--color-pib-text-muted)] text-pretty">
                Gauteng buyers compare quickly. They check your website, Google presence, reviews,
                and recent social proof before they message. The audit looks at that full path.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {AREAS.map((area) => (
                  <span key={area} className="pill">
                    {area}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>

          <div className="grid gap-5 lg:col-span-7 md:grid-cols-2">
            {CASES.map((study, index) => (
              <Reveal key={study.slug} delay={index * 80}>
                <Link href={study.href} className="bento-card group block h-full !p-0 overflow-hidden">
                  <div className="relative aspect-[16/10]">
                    <Image
                      src={study.cover}
                      alt={`${study.client} case study`}
                      fill
                      sizes="(min-width: 1024px) 30vw, 100vw"
                      className="object-cover opacity-75 transition duration-500 group-hover:scale-[1.02] group-hover:opacity-100"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-pib-bg)] via-transparent to-transparent" />
                  </div>
                  <div className="p-6">
                    <p className="eyebrow mb-2">{study.industry}</p>
                    <h3 className="font-display text-2xl leading-tight text-[var(--color-pib-text)]">
                      {study.client}
                    </h3>
                    <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
                      {study.summary}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {study.metrics.slice(0, 2).map((metric) => (
                        <span key={metric.label} className="pill">
                          <strong className="text-[var(--color-pib-accent)]">{metric.value}</strong>{' '}
                          {metric.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib grid gap-5 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <div className="bento-card p-8 md:p-10">
              <p className="eyebrow mb-4">What happens next</p>
              <h2 className="font-display text-3xl md:text-4xl leading-tight text-[var(--color-pib-text)] text-balance">
                A useful audit first. A sprint only if it fits.
              </h2>
              <ol className="mt-6 space-y-4">
                {NEXT_STEPS.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm text-[var(--color-pib-text-muted)]">
                    <span className="font-mono text-[var(--color-pib-accent)]">
                      0{index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
          <Reveal delay={80} className="lg:col-span-7">
            <div className="bento-card h-full p-8 md:p-10">
              <p className="eyebrow mb-4">Why this converts</p>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ['Specific', 'The offer names Gauteng, small businesses, and the three growth levers owners already understand.'],
                  ['Low risk', 'A free audit is easier to accept than a sales call or full project application.'],
                  ['Diagnostic', 'The form asks what is leaking, so the first reply can be personal and useful.'],
                  ['Next step clear', 'The paid 90-day sprint is framed as the answer after evidence, not before trust.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-xl border border-[var(--color-pib-line)] p-4">
                    <h3 className="font-display text-xl text-[var(--color-pib-text)]">{title}</h3>
                    <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{body}</p>
                  </div>
                ))}
              </div>
              <a href="#audit-form" className="btn-pib-accent mt-8">
                Start with the audit
                <span className="material-symbols-outlined text-base">arrow_upward</span>
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="mb-8 max-w-3xl">
              <p className="eyebrow mb-4">FAQ</p>
              <h2 className="h-display text-4xl md:text-5xl text-balance">
                Straight answers before you ask for the audit.
              </h2>
            </div>
          </Reveal>
          <FAQ items={FAQS} />
        </div>
      </section>
    </main>
  )
}
