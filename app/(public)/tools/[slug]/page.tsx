import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { SITE } from '@/lib/seo/site'
import { PUBLIC_TOOLS, toolBySlug, toolSoftwareSchema, type ToolSlug } from '@/lib/tools/catalog'
import { PublicToolInteractive } from '@/components/tools/PublicToolInteractive'
import { Reveal } from '@/components/marketing/Reveal'

export function generateStaticParams() {
  return PUBLIC_TOOLS.map(tool => ({ slug: tool.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const tool = toolBySlug.get(params.slug as ToolSlug)
  if (!tool) return {}

  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.slug}` },
    openGraph: {
      title: `${tool.title} — Partners in Biz`,
      description: tool.description,
      url: `${SITE.url}/tools/${tool.slug}`,
      type: 'website',
    },
  }
}

export default function ToolPage({ params }: { params: { slug: string } }) {
  const tool = toolBySlug.get(params.slug as ToolSlug)
  if (!tool) notFound()

  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Tools', url: '/tools' },
    { name: tool.title, url: `/tools/${tool.slug}` },
  ])

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={toolSoftwareSchema(tool)} />
      <JsonLd data={faqSchema(tool.faqs)} />

      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <Reveal>
            <Link href="/tools" className="pib-link-underline inline-flex items-center gap-1 text-sm text-[var(--color-pib-accent)]">
              <span className="material-symbols-outlined text-base">arrow_back</span>
              All tools
            </Link>
          </Reveal>
          <Reveal delay={80}>
            <p className="eyebrow mb-6 mt-8">{tool.category}</p>
          </Reveal>
          <Reveal delay={140}>
            <h1 className="h-display max-w-5xl text-balance">{tool.title}</h1>
          </Reveal>
          <Reveal delay={220}>
            <p className="mt-8 max-w-2xl text-lg text-[var(--color-pib-text-muted)] text-pretty md:text-xl">
              {tool.description}
            </p>
          </Reveal>
          <Reveal delay={300}>
            <div className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
              {[
                ['Tool mode', tool.difficulty],
                ['Proof angle', tool.proofPoint],
                ['Data handling', 'Browser-first or public-safe wrapper'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 p-5 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">{label}</p>
                  <p className="mt-2 text-sm font-medium text-[var(--color-pib-text)]">{value}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Reveal>
            <PublicToolInteractive slug={tool.slug} />
          </Reveal>

          <aside className="space-y-5">
            <Reveal delay={80}>
              <div className="bento-card p-6">
                <p className="eyebrow mb-4">What you get</p>
                <p className="text-[var(--color-pib-text)] leading-relaxed">{tool.outcome}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {tool.inputs.map(input => (
                    <span key={input} className="pill text-xs">{input}</span>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal delay={140}>
              <div className="bento-card p-6">
                <p className="eyebrow mb-4">Next step</p>
                <h2 className="font-display text-2xl text-[var(--color-pib-text)]">{tool.cta}</h2>
                <p className="mt-3 text-sm text-[var(--color-pib-text-muted)] leading-relaxed">
                  Save the numbers, then ask PiB to turn the result into a practical plan, audit, or build scope.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  <Link href="/start-a-project" className="btn-pib-primary justify-center">
                    Ask PiB to review this
                  </Link>
                  <Link href={tool.serviceHref} className="btn-pib-secondary justify-center">
                    Related service
                  </Link>
                </div>
              </div>
            </Reveal>
          </aside>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib grid gap-6 md:grid-cols-2">
          <div className="bento-card p-7">
            <p className="eyebrow mb-3">How to interpret it</p>
            <p className="text-[var(--color-pib-text-muted)] leading-relaxed">
              Treat the result as a planning signal, not a final quote or guarantee. The strongest next move is the one that improves both the business number and the user experience behind it.
            </p>
          </div>
          <div className="bento-card p-7">
            <p className="eyebrow mb-3">Privacy and scope</p>
            <p className="text-[var(--color-pib-text-muted)] leading-relaxed">
              This MVP runs in the browser and does not send your calculator inputs to PiB. If you ask us to review the result, we will scope that as a separate conversation.
            </p>
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <div className="grid gap-5 md:grid-cols-2">
            {tool.faqs.map(faq => (
              <div key={faq.q} className="bento-card p-7">
                <h2 className="font-display text-xl text-[var(--color-pib-text)]">{faq.q}</h2>
                <p className="mt-3 text-[var(--color-pib-text-muted)] leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
