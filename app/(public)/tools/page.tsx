import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { SITE } from '@/lib/seo/site'
import { PUBLIC_TOOLS, toolCollectionSchema } from '@/lib/tools/catalog'
import { Reveal } from '@/components/marketing/Reveal'
import { SectionHead } from '@/components/marketing/SectionHead'

export const metadata: Metadata = {
  title: 'Free SEO and Business Growth Tools',
  description:
    'Free Partners in Biz calculators, generators, and SEO checkers for planning growth, website investment, lead value, and metadata improvements.',
  alternates: { canonical: '/tools' },
  openGraph: {
    title: 'Free SEO and Business Growth Tools — Partners in Biz',
    description:
      'Estimate SEO ROI, website cost, lead value, and generate better metadata with practical tools from Partners in Biz.',
    url: `${SITE.url}/tools`,
    type: 'website',
  },
}

export default function ToolsPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Tools', url: '/tools' },
  ])

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={toolCollectionSchema()} />

      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib">
          <Reveal>
            <p className="eyebrow mb-6">Free PiB tools</p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="h-display max-w-5xl text-balance">
              Practical SEO and growth tools for businesses that want proof before spend.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-8 max-w-2xl text-lg text-[var(--color-pib-text-muted)] text-pretty md:text-xl">
              Estimate whether SEO is worth it, scope website investment, work out lead value,
              and improve page metadata before you ask anyone for a proposal.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/tools/seo-roi-calculator" className="btn-pib-primary">
                Start with SEO ROI
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href="/start-a-project" className="btn-pib-secondary">
                Ask PiB to review results
              </Link>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <div className="mt-12 grid max-w-4xl gap-3 sm:grid-cols-3">
              {[
                ['8', 'public tools'],
                ['0', 'account required'],
                ['Safe', 'URL audit wrappers'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-5 py-4 backdrop-blur">
                  <p className="font-display text-3xl text-[var(--color-pib-text)]">{value}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">{label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {PUBLIC_TOOLS.map((tool, index) => (
              <Reveal key={tool.slug} delay={index * 60}>
                <Link href={`/tools/${tool.slug}`} className="bento-card group relative flex h-full flex-col gap-6 overflow-hidden p-8 transition duration-300 hover:-translate-y-1 hover:border-[var(--color-pib-accent)]/50 hover:shadow-[0_24px_90px_rgba(50,255,214,0.14)]">
                  <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-pib-accent)]/50 to-transparent opacity-0 transition group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-4">
                    <span
                      className="material-symbols-outlined text-[var(--color-pib-accent)]"
                      style={{ fontSize: '38px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                    >
                      {tool.icon}
                    </span>
                    <span className="pill text-xs">{tool.category}</span>
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-2xl leading-tight text-[var(--color-pib-text)]">
                      {tool.title}
                    </h2>
                    <p className="mt-4 text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                  <div className="grid gap-3 rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">Output</p>
                      <p className="mt-2 text-sm text-[var(--color-pib-text)]">{tool.outcome}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">Proof angle</p>
                      <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{tool.proofPoint}</p>
                    </div>
                  </div>
                  <div className="pib-link-underline inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-pib-accent)]">
                    Use the tool
                    <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-1">arrow_forward</span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <div className="bento-card mb-8 grid gap-6 overflow-hidden p-8 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <p className="eyebrow mb-4">Built like a mini growth lab</p>
              <h2 className="font-display text-3xl text-[var(--color-pib-text)] md:text-5xl">Calculators for commercial judgement. Checkers for technical proof. CTAs for real work.</h2>
            </div>
            <div className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/50 p-5 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              The live URL tools use hardened public wrappers instead of internal admin SEO routes: private-network targets are blocked, redirects are limited, responses are capped, and output is sanitised into practical issues and quick wins.
            </div>
          </div>
          <SectionHead
            eyebrow="How to use them"
            title="Free first. Commercial when the numbers make sense."
            subtitle="The tools give you a useful result immediately. If the result exposes a real opportunity or a problem worth fixing, PiB can turn it into an audit, SEO sprint, website fix, or growth system."
          />
          <div className="grid gap-5 md:grid-cols-3">
            {[
              ['Run the tool', 'Bring rough numbers or paste draft copy. The tools are deterministic and do not need an account.'],
              ['Read the limitation', 'Every tool explains what the result can and cannot prove so you do not overcommit from a single metric.'],
              ['Turn it into work', 'Use the CTA when you want PiB to review the result and scope the highest-value next fix.'],
            ].map(([title, body]) => (
              <div key={title} className="bento-card p-7">
                <h3 className="font-display text-2xl text-[var(--color-pib-text)]">{title}</h3>
                <p className="mt-3 text-[var(--color-pib-text-muted)] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
