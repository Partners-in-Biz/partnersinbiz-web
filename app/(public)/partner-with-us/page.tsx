import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import PartnerWithUsForm from './PartnerWithUsForm'

export const metadata: Metadata = {
  title: 'Partner with us',
  description:
    'Apply to partner with Partners in Biz ventures, starting with I am Ballito regional coupon partnerships and Athleet ground sales partnerships.',
  alternates: { canonical: '/partner-with-us' },
  openGraph: {
    title: 'Partner with us — Partners in Biz',
    description:
      'Regional, on-the-ground partnership applications for I am Ballito and Athleet.',
    url: `${SITE.url}/partner-with-us`,
    type: 'website',
  },
}

const VENTURES = [
  {
    name: 'I am Ballito',
    eyebrow: 'Regional coupon partnerships',
    icon: 'public',
    summary:
      'For operators who want to own a region, onboard local businesses, and grow the coupon marketplace on the ground.',
    points: ['Regional partnership applications', 'Merchant and deal acquisition', 'Local coupon ecosystem growth'],
  },
  {
    name: 'Athleet',
    eyebrow: 'Ground sales partnerships',
    icon: 'campaign',
    summary:
      'For people who can introduce the athlete-management platform to wrestling clubs, sports clubs, schools, and circles they already know.',
    points: ['Club and coach introductions', 'On-the-ground selling', 'Sports community relationships'],
  },
]

const FIT = [
  'You already know a region, club network, or community.',
  'You can open real conversations, not just forward links.',
  'You want a venture-style partnership with clear ground rules.',
]

export default function PartnerWithUsPage() {
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
                Build a region. Grow a venture.
              </h1>
            </Reveal>
            <Reveal delay={160} eager>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-yellow-50/75 md:text-xl">
                We are opening partnership applications for ventures where local relationships matter. First up: I am Ballito regional coupon partnerships and Athleet ground sales partnerships.
              </p>
            </Reveal>
            <Reveal delay={240} eager>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href="#apply" className="inline-flex items-center gap-2 rounded-full bg-yellow-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-yellow-200">
                  Apply now
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </a>
                <Link href="/work/athleet" prefetch={false} className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 px-6 py-3 text-sm font-medium text-yellow-50 transition hover:border-yellow-200 hover:bg-yellow-300/10">
                  See Athleet
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={280} eager className="lg:col-span-5">
            <div className="rounded-[2rem] border border-yellow-300/35 bg-yellow-300/10 p-6 shadow-[0_0_80px_rgba(250,204,21,0.16)] md:p-8">
              <p className="eyebrow mb-5 text-yellow-200">Starting lanes</p>
              <div className="space-y-4">
                {VENTURES.map((venture) => (
                  <div key={venture.name} className="rounded-3xl border border-yellow-300/25 bg-black/25 p-5">
                    <div className="flex items-start gap-4">
                      <span className="material-symbols-outlined rounded-2xl bg-yellow-300 px-3 py-3 text-2xl text-black">{venture.icon}</span>
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-yellow-200/80">{venture.eyebrow}</p>
                        <h2 className="mt-2 font-display text-2xl text-yellow-50">{venture.name}</h2>
                        <p className="mt-3 text-sm leading-relaxed text-yellow-50/70">{venture.summary}</p>
                      </div>
                    </div>
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

      <section className="section">
        <div className="container-pib grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="eyebrow mb-5 text-yellow-200">Two venture paths</p>
            <div className="grid gap-5">
              {VENTURES.map((venture) => (
                <Reveal key={venture.name}>
                  <article className="rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6 md:p-8">
                    <div className="flex flex-col gap-5 md:flex-row md:items-start">
                      <span className="material-symbols-outlined w-fit rounded-2xl bg-yellow-300 px-3 py-3 text-3xl text-black">{venture.icon}</span>
                      <div>
                        <p className="eyebrow text-yellow-200">{venture.eyebrow}</p>
                        <h2 className="mt-2 font-display text-3xl text-yellow-50 md:text-4xl">{venture.name}</h2>
                        <p className="mt-4 max-w-2xl text-yellow-50/70">{venture.summary}</p>
                        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                          {venture.points.map((point) => (
                            <li key={point} className="rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm text-yellow-50/75">
                              <span className="material-symbols-outlined mb-2 block text-base text-yellow-300">check</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>

          <div id="apply" className="scroll-mt-28 lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <PartnerWithUsForm />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
