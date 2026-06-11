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
    <main className="relative">
      <JsonLd data={breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Partner with us', url: '/partner-with-us' },
        { name: opportunity.title, url: opportunity.href },
      ])} />

      {/* Hero */}
      <section className="section relative overflow-hidden pt-28 md:pt-36 pb-0">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <Reveal eager>
            <Link href="/partner-with-us" prefetch={false} className="btn-pib-secondary">
              <span className="material-symbols-outlined text-base">arrow_back</span>
              All ventures
            </Link>
          </Reveal>

          <Reveal delay={80} eager>
            <div className="mt-10 flex items-center gap-3">
              <span
                className="material-symbols-outlined text-[var(--color-pib-accent)]"
                style={{ fontSize: '32px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
              >
                {opportunity.icon}
              </span>
              <span className="pill text-xs">{opportunity.eyebrow}</span>
            </div>
          </Reveal>
          <Reveal delay={120} eager>
            <h1 className="mt-6 h-display text-balance max-w-4xl">{opportunity.venture}</h1>
          </Reveal>
          <Reveal delay={160} eager>
            <p className="mt-3 text-lg font-medium text-[var(--color-pib-accent)]">{opportunity.tagline}</p>
          </Reveal>
          <Reveal delay={200} eager>
            <p className="mt-6 max-w-3xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
              {opportunity.pitch}
            </p>
          </Reveal>

          <Reveal delay={260} eager>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {opportunity.liveUrl && (
                <a
                  href={opportunity.liveUrl}
                  target={opportunity.liveUrl.startsWith('http') ? '_blank' : undefined}
                  rel={opportunity.liveUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="btn-pib-accent"
                >
                  {opportunity.liveLabel ?? 'See it live'}
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                </a>
              )}
              <a href="#apply" className="btn-pib-secondary">
                Register interest
                <span className="material-symbols-outlined text-base">arrow_downward</span>
              </a>
            </div>
          </Reveal>

          {/* Stats strip */}
          <Reveal delay={320} eager>
            <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-[var(--color-pib-line)] bg-[var(--color-pib-line)]">
              {opportunity.stats.map((stat) => (
                <div key={stat.label} className="bg-[var(--color-pib-surface)] p-5 md:p-6">
                  <p className="eyebrow !text-xs text-[var(--color-pib-text-faint)]">{stat.label}</p>
                  <p className="mt-2 text-sm md:text-base font-medium text-[var(--color-pib-text)]">{stat.value}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container-pib grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7 grid gap-6">
            {/* What's built */}
            <Reveal>
              <div className="bento-card p-8 md:p-10">
                <p className="eyebrow mb-6">What is already built</p>
                <ul className="grid gap-4">
                  {opportunity.whatsBuilt.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[var(--color-pib-text)] leading-relaxed">
                      <span className="material-symbols-outlined mt-0.5 text-lg text-[var(--color-pib-accent)]">check_circle</span>
                      <span className="text-pretty">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* Role + upside */}
            <div className="grid gap-6 md:grid-cols-2">
              <Reveal>
                <div className="bento-card h-full p-8">
                  <p className="eyebrow mb-6">Where you come in</p>
                  <ol className="grid gap-4">
                    {opportunity.whatYouDo.map((item, index) => (
                      <li key={item} className="flex items-start gap-3 text-[var(--color-pib-text)] leading-relaxed">
                        <span className="font-mono text-sm text-[var(--color-pib-accent)] mt-0.5">0{index + 1}</span>
                        <span className="text-pretty">{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>
              <Reveal delay={60}>
                <div className="bento-card h-full p-8">
                  <p className="eyebrow mb-6">What you get</p>
                  <ul className="grid gap-4">
                    {opportunity.whatYouGet.map((item) => (
                      <li key={item} className="flex items-start gap-3 text-[var(--color-pib-text)] leading-relaxed">
                        <span className="material-symbols-outlined mt-0.5 text-lg text-[var(--color-pib-accent)]">handshake</span>
                        <span className="text-pretty">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>

            {/* Detail cards */}
            <div className="grid gap-6 md:grid-cols-2">
              <InfoCard title="Who this is for" body={opportunity.partnerProfile} icon="groups" />
              <InfoCard title="Commercial conversation" body={opportunity.commercialModel} icon="payments" />
              <InfoCard title="Proof and review material" body={opportunity.proofNeeded} icon="fact_check" />
              <InfoCard title="Sites, links, and login details" body={opportunity.reviewerAccess} icon="lock" />
            </div>

            {/* Next steps */}
            <Reveal>
              <div className="bento-card p-8 md:p-10">
                <p className="eyebrow mb-6">Expected next steps</p>
                <ol className="grid gap-4">
                  {opportunity.nextSteps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3 text-[var(--color-pib-text)] leading-relaxed">
                      <span className="font-mono text-sm text-[var(--color-pib-accent)] mt-0.5">0{index + 1}</span>
                      <span className="text-pretty">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </Reveal>
          </div>

          <aside id="apply" className="scroll-mt-28 lg:col-span-5 lg:sticky lg:top-28">
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
      <article className="bento-card h-full p-8">
        <span
          className="material-symbols-outlined text-[var(--color-pib-accent)]"
          style={{ fontSize: '28px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
        >
          {icon}
        </span>
        <h2 className="mt-4 text-lg font-display text-[var(--color-pib-text)]">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-pib-text-muted)] text-pretty">{body}</p>
      </article>
    </Reveal>
  )
}
