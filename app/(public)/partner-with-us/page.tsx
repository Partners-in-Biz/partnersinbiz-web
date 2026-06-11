import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'
import PartnerWithUsForm from './PartnerWithUsForm'

export const metadata: Metadata = {
  title: 'Partner with us | Opportunity signup funnel',
  description:
    'Explore specific Partners in Biz opportunity lanes, open the detail page for the right fit, and register structured interest for that opportunity.',
  alternates: { canonical: '/partner-with-us' },
  openGraph: {
    title: 'Partner with us — Partners in Biz opportunities',
    description:
      'Specific regional, sports, and local-growth partnership opportunities with dedicated interest registration.',
    url: `${SITE.url}/partner-with-us`,
    type: 'website',
  },
}

const FIT = [
  'You can open real conversations in a region, club network, or business community.',
  'You can show evidence: links, relationships, demo assets, or a practical first-introduction plan.',
  'You understand that real credentials need secure handoff — public forms are for demo access and interest data only.',
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
                Choose the opportunity. Register for that exact lane.
              </h1>
            </Reveal>
            <Reveal delay={160} eager>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-yellow-50/75 md:text-xl">
                This is now a proper opportunity funnel: browse specific lanes, open the detail page, share useful follow-up data, and register interest for the opportunity that actually fits you.
              </p>
            </Reveal>
            <Reveal delay={240} eager>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href="#opportunities" className="inline-flex items-center gap-2 rounded-full bg-yellow-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-yellow-200">
                  View opportunities
                  <span className="material-symbols-outlined text-base">arrow_downward</span>
                </a>
                <Link href={featured.href} prefetch={false} className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 px-6 py-3 text-sm font-medium text-yellow-50 transition hover:border-yellow-200 hover:bg-yellow-300/10">
                  Open featured lane
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={280} eager className="lg:col-span-5">
            <div className="rounded-[2rem] border border-yellow-300/35 bg-yellow-300/10 p-6 shadow-[0_0_80px_rgba(250,204,21,0.16)] md:p-8">
              <p className="eyebrow mb-5 text-yellow-200">Funnel path</p>
              <div className="space-y-4">
                {['Opportunity index', 'Dedicated detail page', 'Structured interest form', 'Confirmation and follow-up'].map((step, index) => (
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

      <section id="opportunities" className="section scroll-mt-28">
        <div className="container-pib grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow mb-5 text-yellow-200">Open opportunity lanes</p>
            <div className="grid gap-5">
              {PARTNER_OPPORTUNITIES.map((opportunity) => (
                <Reveal key={opportunity.id}>
                  <Link href={opportunity.href} prefetch={false} className="group block rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6 transition hover:-translate-y-1 hover:border-yellow-200/70 hover:bg-yellow-300/15 md:p-8">
                    <article>
                      <div className="flex flex-col gap-5 md:flex-row md:items-start">
                        <span className="material-symbols-outlined w-fit rounded-2xl bg-yellow-300 px-3 py-3 text-3xl text-black">{opportunity.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="eyebrow text-yellow-200">{opportunity.eyebrow}</p>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <h2 className="font-display text-3xl text-yellow-50 md:text-4xl">{opportunity.title}</h2>
                            <span className="inline-flex items-center gap-2 rounded-full bg-yellow-300 px-4 py-2 text-xs font-semibold text-black">
                              View details
                              <span className="material-symbols-outlined text-base transition group-hover:translate-x-1">arrow_forward</span>
                            </span>
                          </div>
                          <p className="mt-4 max-w-2xl text-yellow-50/70">{opportunity.summary}</p>
                          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                            {opportunity.points.map((point) => (
                              <li key={point} className="rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm text-yellow-50/75">
                                <span className="material-symbols-outlined mb-2 block text-base text-yellow-300">check</span>
                                {point}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </article>
                  </Link>
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
