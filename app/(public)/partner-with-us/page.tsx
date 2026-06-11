import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'
import PartnerWithUsForm from './PartnerWithUsForm'

export const metadata: Metadata = {
  title: 'Partner with us | Real ventures, open for partners',
  description:
    'Partner in the ventures we build and run: I am Ballito, Athleet, and our productized growth services. Bring a region, a sport network, or a client book — the products are live.',
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
  'Pick the venture that fits your reach',
  'See what is already built — every product is live',
  'Register interest with real context',
  'Fit review, then terms and a proper handoff',
]

const FIT = [
  'You bring reach: a region you know, a sport network you are inside, or a client book that trusts you.',
  'We bring finished, live products and the delivery engine behind them — you are not selling a prototype.',
  'Terms are agreed properly after a fit review. Real credentials only ever move through a secure handoff, never the public form.',
]

export default function PartnerWithUsPage() {
  const featured = PARTNER_OPPORTUNITIES[0]

  return (
    <main className="relative overflow-hidden bg-[#120d00] text-yellow-50">
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Partner with us', url: '/partner-with-us' }])} />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.28),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(234,179,8,0.22),transparent_34%)]" />
      <div className="absolute inset-0 -z-10 opacity-30 pib-grid-bg" />

      <section className="pt-28 pb-16 md:pt-40 md:pb-24">
        <div className="container-pib grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <Reveal eager>
              <p className="eyebrow mb-6 text-yellow-200">Partner with us</p>
            </Reveal>
            <Reveal delay={80} eager>
              <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-yellow-50 md:text-7xl lg:text-8xl">
                We build ventures. Own a piece of one.
              </h1>
            </Reveal>
            <Reveal delay={160} eager>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-yellow-50/75 md:text-xl">
                Partners in Biz builds and operates its own products — a live local commerce platform, a sports club SaaS, and a
                productized growth service. Each one has room for the right partner: businesses and individuals who bring a region,
                a network, or a client book and want to share in what it grows into.
              </p>
            </Reveal>
            <Reveal delay={240} eager>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href="#ventures" className="inline-flex items-center gap-2 rounded-full bg-yellow-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-yellow-200">
                  See the ventures
                  <span className="material-symbols-outlined text-base">arrow_downward</span>
                </a>
                <Link href={featured.href} prefetch={false} className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 px-6 py-3 text-sm font-medium text-yellow-50 transition hover:border-yellow-200 hover:bg-yellow-300/10">
                  Explore {featured.venture}
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={280} eager className="lg:col-span-5">
            <div className="rounded-[2rem] border border-yellow-300/35 bg-yellow-300/10 p-6 shadow-[0_0_80px_rgba(250,204,21,0.16)] md:p-8">
              <p className="eyebrow mb-5 text-yellow-200">How partnering works</p>
              <div className="space-y-4">
                {HOW_IT_WORKS.map((step, index) => (
                  <div key={step} className="flex items-center gap-4 rounded-3xl border border-yellow-300/25 bg-black/25 p-5">
                    <span className="font-mono text-sm text-yellow-300">0{index + 1}</span>
                    <p className="text-sm font-semibold text-yellow-50">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-y border-yellow-300/20 bg-yellow-300/10 py-12">
        <div className="container-pib grid gap-4 md:grid-cols-3">
          {FIT.map((item, index) => (
            <Reveal key={item} delay={index * 70}>
              <div className="h-full rounded-3xl border border-yellow-300/25 bg-black/25 p-5">
                <span className="font-mono text-sm text-yellow-300">0{index + 1}</span>
                <p className="mt-4 text-base leading-relaxed text-yellow-50/80">{item}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="ventures" className="section scroll-mt-28">
        <div className="container-pib grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow mb-5 text-yellow-200">Open ventures</p>
            <div className="grid gap-5">
              {PARTNER_OPPORTUNITIES.map((opportunity) => (
                <Reveal key={opportunity.id}>
                  <article className="rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6 transition hover:border-yellow-200/70 hover:bg-yellow-300/15 md:p-8">
                    <div className="flex flex-col gap-5 md:flex-row md:items-start">
                      <span className="material-symbols-outlined w-fit rounded-2xl bg-yellow-300 px-3 py-3 text-3xl text-black">{opportunity.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow text-yellow-200">{opportunity.eyebrow}</p>
                        <h2 className="mt-2 font-display text-3xl text-yellow-50 md:text-4xl">{opportunity.venture}</h2>
                        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-yellow-300/90">{opportunity.tagline}</p>
                        <p className="mt-4 max-w-2xl text-yellow-50/70">{opportunity.summary}</p>

                        <div className="mt-6 flex flex-wrap gap-2">
                          {opportunity.stats.map((stat) => (
                            <span key={stat.label} className="rounded-full border border-yellow-300/25 bg-black/25 px-4 py-2 text-xs text-yellow-50/80">
                              <span className="text-yellow-300">{stat.label}:</span> {stat.value}
                            </span>
                          ))}
                        </div>

                        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                          {opportunity.points.map((point) => (
                            <li key={point} className="rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm text-yellow-50/75">
                              <span className="material-symbols-outlined mb-2 block text-base text-yellow-300">check</span>
                              {point}
                            </li>
                          ))}
                        </ul>

                        <div className="mt-7 flex flex-wrap gap-3">
                          <Link href={opportunity.href} prefetch={false} className="group inline-flex items-center gap-2 rounded-full bg-yellow-300 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-yellow-200">
                            Explore this venture
                            <span className="material-symbols-outlined text-base transition group-hover:translate-x-1">arrow_forward</span>
                          </Link>
                          {opportunity.liveUrl && (
                            <a
                              href={opportunity.liveUrl}
                              target={opportunity.liveUrl.startsWith('http') ? '_blank' : undefined}
                              rel={opportunity.liveUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                              className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 px-5 py-2.5 text-sm font-medium text-yellow-50 transition hover:border-yellow-200 hover:bg-yellow-300/10"
                            >
                              {opportunity.liveLabel ?? 'See it live'}
                              <span className="material-symbols-outlined text-base">open_in_new</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
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
      </section>
    </main>
  )
}
