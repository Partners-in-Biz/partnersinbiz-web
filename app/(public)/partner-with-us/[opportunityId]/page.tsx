import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { getPartnerOpportunity, PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'
import PartnerWithUsForm from '../PartnerWithUsForm'

type PageProps = {
  params: Promise<{ opportunityId: string }>
}

export async function generateStaticParams() {
  return PARTNER_OPPORTUNITIES.map((opportunity) => ({ opportunityId: opportunity.id }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { opportunityId } = await params
  const opportunity = getPartnerOpportunity(opportunityId)
  if (!opportunity) return {}

  return {
    title: `${opportunity.title} | Partner opportunity`,
    description: opportunity.summary,
    alternates: { canonical: opportunity.href },
    openGraph: {
      title: `${opportunity.title} — Partners in Biz`,
      description: opportunity.summary,
      url: `${SITE.url}${opportunity.href}`,
      type: 'website',
    },
  }
}

export default async function PartnerOpportunityPage({ params }: PageProps) {
  const { opportunityId } = await params
  const opportunity = getPartnerOpportunity(opportunityId)
  if (!opportunity) notFound()

  return (
    <main className="relative overflow-hidden bg-[#120d00] text-yellow-50">
      <JsonLd data={breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Partner with us', url: '/partner-with-us' },
        { name: opportunity.title, url: opportunity.href },
      ])} />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.28),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(234,179,8,0.22),transparent_34%)]" />
      <div className="absolute inset-0 -z-10 opacity-30 pib-grid-bg" />

      <section className="pt-28 pb-12 md:pt-36 md:pb-16">
        <div className="container-pib">
          <Link href="/partner-with-us" prefetch={false} className="inline-flex items-center gap-2 rounded-full border border-yellow-300/30 px-4 py-2 text-sm text-yellow-50/80 transition hover:border-yellow-200 hover:bg-yellow-300/10">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            All ventures
          </Link>
        </div>
      </section>

      <section className="pb-20">
        <div className="container-pib grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <Reveal eager>
              <div className="inline-flex items-center gap-3 rounded-full border border-yellow-300/25 bg-yellow-300/10 px-4 py-2 text-sm text-yellow-100">
                <span className="material-symbols-outlined text-base text-yellow-300">{opportunity.icon}</span>
                {opportunity.eyebrow}
              </div>
            </Reveal>
            <Reveal delay={80} eager>
              <h1 className="mt-6 font-display text-5xl leading-[0.95] tracking-tight text-yellow-50 md:text-7xl">
                {opportunity.venture}
              </h1>
            </Reveal>
            <Reveal delay={120} eager>
              <p className="mt-4 text-base font-semibold uppercase tracking-wide text-yellow-300/90">{opportunity.tagline}</p>
            </Reveal>
            <Reveal delay={160} eager>
              <p className="mt-6 max-w-3xl text-lg leading-relaxed text-yellow-50/75 md:text-xl">
                {opportunity.pitch}
              </p>
            </Reveal>

            {opportunity.liveUrl && (
              <Reveal delay={220} eager>
                <a
                  href={opportunity.liveUrl}
                  target={opportunity.liveUrl.startsWith('http') ? '_blank' : undefined}
                  rel={opportunity.liveUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-yellow-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-yellow-200"
                >
                  {opportunity.liveLabel ?? 'See it live'}
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                </a>
              </Reveal>
            )}

            <Reveal delay={260} eager>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {opportunity.stats.map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-yellow-300/20 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-wide text-yellow-300/80">{stat.label}</p>
                    <p className="mt-1 text-sm font-semibold text-yellow-50">{stat.value}</p>
                  </div>
                ))}
              </div>
            </Reveal>

            <div className="mt-12 rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6 md:p-8">
              <p className="eyebrow text-yellow-200">What is already built</p>
              <ul className="mt-5 grid gap-3">
                {opportunity.whatsBuilt.map((item) => (
                  <li key={item} className="flex gap-3 rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm leading-relaxed text-yellow-50/75">
                    <span className="material-symbols-outlined mt-0.5 text-base text-yellow-300">check_circle</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <div className="rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6">
                <p className="eyebrow text-yellow-200">Where you come in</p>
                <ol className="mt-5 grid gap-3">
                  {opportunity.whatYouDo.map((item, index) => (
                    <li key={item} className="flex gap-3 rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm leading-relaxed text-yellow-50/75">
                      <span className="font-mono text-yellow-300">0{index + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6">
                <p className="eyebrow text-yellow-200">What you get</p>
                <ul className="mt-5 grid gap-3">
                  {opportunity.whatYouGet.map((item) => (
                    <li key={item} className="flex gap-3 rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm leading-relaxed text-yellow-50/75">
                      <span className="material-symbols-outlined mt-0.5 text-base text-yellow-300">handshake</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-10 grid gap-5">
              <InfoCard title="Who this is for" body={opportunity.partnerProfile} icon="groups" />
              <InfoCard title="Commercial conversation" body={opportunity.commercialModel} icon="handshake" />
              <InfoCard title="Proof and review material" body={opportunity.proofNeeded} icon="fact_check" />
              <InfoCard title="Sites, links, and login details" body={opportunity.reviewerAccess} icon="lock" />
            </div>

            <div className="mt-10 rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6 md:p-8">
              <p className="eyebrow text-yellow-200">Expected next steps</p>
              <ol className="mt-5 grid gap-4">
                {opportunity.nextSteps.map((step, index) => (
                  <li key={step} className="flex gap-4 rounded-2xl border border-yellow-300/20 bg-black/25 p-4 text-sm text-yellow-50/75">
                    <span className="font-mono text-yellow-300">0{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <aside className="lg:col-span-5 lg:sticky lg:top-28">
            <PartnerWithUsForm
              opportunity={{
                id: opportunity.id,
                title: opportunity.title,
                sourcePath: opportunity.href,
              }}
            />
          </aside>
        </div>
      </section>
    </main>
  )
}

function InfoCard({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <Reveal>
      <article className="rounded-[2rem] border border-yellow-300/25 bg-yellow-300/10 p-6">
        <div className="flex gap-4">
          <span className="material-symbols-outlined h-fit rounded-2xl bg-yellow-300 px-3 py-3 text-2xl text-black">{icon}</span>
          <div>
            <h2 className="font-display text-2xl text-yellow-50">{title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-yellow-50/70">{body}</p>
          </div>
        </div>
      </article>
    </Reveal>
  )
}
