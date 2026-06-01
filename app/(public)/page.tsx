import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { SITE, SERVICES, CASE_STUDIES, TESTIMONIALS, STATS, TECH_STACK, PROCESS, FAQ_HOMEPAGE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { CountUp } from '@/components/marketing/CountUp'
import { Marquee } from '@/components/marketing/Marquee'
import { FAQ } from '@/components/marketing/FAQ'
import { SectionHead } from '@/components/marketing/SectionHead'

export const metadata: Metadata = {
  title: 'Web, AI & Growth Studio for Ambitious SMEs',
  description: SITE.description,
  alternates: { canonical: '/' },
  openGraph: { url: '/', images: ['/og/default.png'] },
}

const CLIENT_LOGOS = [
  'Athleet', 'Loyalty Plus', 'AHS Law', 'Scrolled Brain',
  'Lumen', 'Velox', 'Covalonic', 'Nexus',
]

export default function HomePage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }])} />
      <JsonLd data={faqSchema([...FAQ_HOMEPAGE])} />

      {/* HERO */}
      <section className="relative pt-28 md:pt-40 pb-20 md:pb-28 overflow-hidden">
        <div className="absolute inset-0 pib-mesh pointer-events-none" />
        <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-40" />

        <div className="container-pib relative">
          <Reveal eager>
            <div className="flex items-center gap-2.5 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-[var(--color-pib-success)] opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-pib-success)]" />
              </span>
              <span className="eyebrow text-[var(--color-pib-text-muted)]">Open for new work · April 2026</span>
            </div>
          </Reveal>

          <Reveal delay={80} eager>
            <h1 className="h-display text-balance max-w-[18ch]">
              Software your competitors will <em className="not-italic text-[var(--color-pib-accent)]">copy.</em>
            </h1>
          </Reveal>

          <Reveal delay={160} eager>
            <p className="mt-8 text-xl md:text-2xl text-[var(--color-pib-text-muted)] max-w-2xl text-pretty leading-snug">
              Partners in Biz is a Pretoria-based studio. We build websites, web apps, mobile apps, and AI integrations
              that ship in weeks — and keep working long after.
            </p>
          </Reveal>

          <Reveal delay={240} eager>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/start-a-project" prefetch={false} className="btn-pib-accent">
                Start a project
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href="/work" prefetch={false} className="btn-pib-secondary">
                See the work
              </Link>
              <Link href="/gauteng-growth-audit" prefetch={false} className="btn-pib-secondary">
                Free growth audit
              </Link>
            </div>
          </Reveal>

          {/* Hero bento — 4 work tiles forming the proof block */}
          <Reveal delay={320} eager>
            <div className="mt-20 md:mt-28 grid grid-cols-12 gap-3 md:gap-4">
              {/* Big featured work tile */}
              <Link
                href={CASE_STUDIES[0].href}
                prefetch={false}
                className="col-span-12 md:col-span-7 row-span-2 group bento-card !p-0 aspect-[4/3] md:aspect-auto md:min-h-[420px] relative overflow-hidden"
              >
                <Image
                  src={CASE_STUDIES[0].cover}
                  alt={`${CASE_STUDIES[0].client} case study cover`}
                  fill
                  sizes="(min-width: 768px) 60vw, 100vw"
                  priority
                  className="object-cover opacity-70 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-pib-bg)] via-[var(--color-pib-bg)]/40 to-transparent" />
                <div className="absolute inset-0 p-6 md:p-8 flex flex-col justify-between">
                  <div className="flex items-center gap-2">
                    <span className="pill pill-accent">Featured · {CASE_STUDIES[0].industry}</span>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-[var(--color-pib-text-muted)] mb-2">{CASE_STUDIES[0].client}</p>
                    <p className="font-display text-2xl md:text-3xl text-balance leading-tight">
                      {CASE_STUDIES[0].headline}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {CASE_STUDIES[0].metrics.slice(0, 3).map((m) => (
                        <span key={m.label} className="pill text-[var(--color-pib-text)]">
                          <strong className="text-[var(--color-pib-accent)]">{m.value}</strong> {m.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Link>

              {/* 3 smaller tiles */}
              {CASE_STUDIES.slice(1, 4).map((c) => (
                <Link
                  key={c.slug}
                  href={c.href}
                  prefetch={false}
                  className="col-span-6 md:col-span-5 group bento-card !p-0 aspect-[5/3] relative overflow-hidden md:aspect-auto md:min-h-[200px]"
                  style={{ gridColumn: 'span 6 / span 6' }}
                >
                  <Image
                    src={c.cover}
                    alt={`${c.client} cover`}
                    fill
                    sizes="(min-width: 768px) 35vw, 50vw"
                    className="object-cover opacity-50 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-pib-bg)]/95 via-[var(--color-pib-bg)]/60 to-transparent" />
                  <div className="absolute inset-0 p-5 flex flex-col justify-end">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">{c.industry}</p>
                    <p className="font-display text-lg md:text-xl mt-1 text-balance leading-tight">{c.client}</p>
                  </div>
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* LOGO MARQUEE */}
      <section className="py-16 border-y border-[var(--color-pib-line)]">
        <div className="container-pib mb-8">
          <p className="eyebrow text-center">Trusted by founders shipping things that matter</p>
        </div>
        <Marquee>
          {CLIENT_LOGOS.map((name) => (
            <div key={name} className="flex items-center gap-3 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">
              <span className="material-symbols-outlined text-2xl text-[var(--color-pib-accent)]/60">stars</span>
              <span className="font-display text-2xl md:text-3xl whitespace-nowrap">{name}</span>
            </div>
          ))}
        </Marquee>
      </section>

      {/* SERVICES */}
      <section className="section">
        <div className="container-pib">
          <SectionHead
            eyebrow="Services"
            title={<>Six ways we work with you.</>}
            subtitle="From a 4-week marketing site to a multi-quarter AI platform build. We pick the right shape, not the most billable one."
            href="/services"
            cta="All services"
          />

          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            {SERVICES.map((s, i) => (
              <Reveal key={s.slug} delay={i * 60}>
                <Link
                  href={`/services/${s.slug}`}
                  prefetch={false}
                  className={`bento-card flex flex-col h-full ${i === 0 || i === 4 ? 'md:col-span-1' : ''}`}
                >
                  <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)] mb-6">{s.icon}</span>
                  <h3 className="font-display text-2xl mb-2">{s.name}</h3>
                  <p className="text-sm text-[var(--color-pib-text-muted)] mb-4">{s.short}</p>
                  <p className="text-[var(--color-pib-text)] flex-1 text-pretty">{s.outcome}</p>
                  <div className="mt-6 pt-6 border-t border-[var(--color-pib-line)] flex items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      {s.keywords.slice(0, 2).map((k) => (
                        <span key={k} className="pill !text-[10px] !py-1 !px-2">{k}</span>
                      ))}
                    </div>
                    <span className="text-xs text-[var(--color-pib-text-muted)] flex items-center gap-1 group-hover:text-[var(--color-pib-accent)]">
                      Learn
                      <span className="material-symbols-outlined text-sm">arrow_outward</span>
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal delay={SERVICES.length * 60}>
            <Link
              href="/properties"
              prefetch={false}
              className="bento-card mt-5 md:mt-6 group flex flex-col md:flex-row md:items-center gap-6 md:gap-10 p-8 md:p-10 relative overflow-hidden"
            >
              <span className="pill pill-accent absolute top-4 right-4 !text-[10px]">New</span>
              <span className="material-symbols-outlined text-5xl text-[var(--color-pib-accent)] shrink-0">tune</span>
              <div className="flex-1">
                <h3 className="font-display text-2xl md:text-3xl mb-2 text-balance">
                  Properties — runtime control for client sites &amp; apps
                </h3>
                <p className="text-[var(--color-pib-text-muted)] text-pretty">
                  Update store URLs, run feature flags, see real analytics, and trigger nurture sequences across every client surface — without a single redeploy.
                </p>
              </div>
              <span className="text-sm font-medium inline-flex items-center gap-1.5 text-[var(--color-pib-accent)] shrink-0">
                Explore Properties
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </span>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* FEATURED WORK — alternating rows */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <SectionHead
            eyebrow="Selected work"
            title={<>Recent builds.</>}
            subtitle="Real production code shipped to real businesses. Pick one to see the brief, the build, and the metrics."
            href="/work"
            cta="All work"
          />

          <div className="space-y-12 md:space-y-24">
            {CASE_STUDIES.slice(0, 3).map((c, i) => (
              <Reveal key={c.slug}>
                <Link
                  href={c.href}
                  prefetch={false}
                  className={`group grid md:grid-cols-12 gap-6 md:gap-12 items-center ${
                    i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''
                  }`}
                >
                  <div className="md:col-span-7 relative aspect-[16/10] rounded-2xl overflow-hidden border border-[var(--color-pib-line)]">
                    <Image
                      src={c.cover}
                      alt={`${c.client} — ${c.headline}`}
                      fill
                      sizes="(min-width: 768px) 55vw, 100vw"
                      className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-pib-bg)]/40 to-transparent" />
                  </div>
                  <div className="md:col-span-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="pill">{c.industry}</span>
                      <span className="pill">{c.year}</span>
                    </div>
                    <h3 className="font-display text-3xl md:text-4xl text-balance leading-[1.05] mb-4 group-hover:text-[var(--color-pib-accent)] transition-colors">
                      {c.headline}
                    </h3>
                    <p className="text-[var(--color-pib-text-muted)] text-pretty mb-6">{c.summary}</p>
                    <div className="grid grid-cols-3 gap-3 mb-6">
                      {c.metrics.map((m) => (
                        <div key={m.label} className="border-l border-[var(--color-pib-line-strong)] pl-3">
                          <div className="font-display text-2xl text-[var(--color-pib-accent)]">{m.value}</div>
                          <div className="text-xs text-[var(--color-pib-text-muted)] leading-tight mt-1">{m.label}</div>
                        </div>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm font-medium pib-link-underline">
                      Read the case study
                      <span className="material-symbols-outlined text-base group-hover:translate-x-1 transition-transform">arrow_forward</span>
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section className="section border-t border-[var(--color-pib-line)] relative overflow-hidden">
        <div className="absolute inset-0 pib-mesh opacity-50" />
        <div className="container-pib relative">
          <SectionHead
            eyebrow="How we work"
            title={<>From idea to live in five steps.</>}
            subtitle="Real artefacts at every phase. Daily Loom updates. Linear board you can read. No nine-month discovery."
            href="/our-process"
            cta="Read the full process"
          />

          <div className="grid md:grid-cols-5 gap-4">
            {PROCESS.map((p, i) => (
              <Reveal key={p.step} delay={i * 80}>
                <div className="bento-card h-full">
                  <div className="font-mono text-xs text-[var(--color-pib-accent)] mb-4">{p.step}</div>
                  <h3 className="font-display text-2xl mb-3">{p.name}</h3>
                  <p className="text-sm text-[var(--color-pib-text-muted)] text-pretty mb-5">{p.blurb}</p>
                  <ul className="space-y-1.5">
                    {p.deliverables.slice(0, 3).map((d) => (
                      <li key={d} className="text-xs text-[var(--color-pib-text-muted)] flex items-start gap-1.5">
                        <span className="text-[var(--color-pib-accent)] mt-0.5">→</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* TECH STACK */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <SectionHead
            eyebrow="Stack"
            title={<>The boring tools that ship.</>}
            subtitle="Battle-tested, well-documented, hireable. We pick what your future team can maintain — not what's trending on Hacker News."
          />
          <div className="flex flex-wrap gap-2.5">
            {TECH_STACK.map((t) => (
              <span key={t} className="pill !py-2 !px-4 !text-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="section border-t border-[var(--color-pib-line)] relative">
        <div className="container-pib">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-pib-line)] border border-[var(--color-pib-line)] rounded-2xl overflow-hidden">
            {STATS.map((s) => {
              const numeric = parseFloat(s.value)
              const decimals = s.value.includes('.') ? 1 : 0
              return (
                <div key={s.label} className="bg-[var(--color-pib-bg)] p-8 md:p-10">
                  <div className="font-display text-5xl md:text-6xl lg:text-7xl text-[var(--color-pib-text)]">
                    <CountUp to={numeric} decimals={decimals} suffix={s.suffix} />
                  </div>
                  <div className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{s.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <SectionHead
            eyebrow="What clients say"
            title={<>Words from people who paid us money.</>}
          />
          <div className="grid md:grid-cols-12 gap-4 md:gap-5">
            <div className="md:col-span-7 bento-card relative">
              <span className="font-display text-7xl absolute top-4 left-6 text-[var(--color-pib-accent)]/40">&ldquo;</span>
              <blockquote className="font-display text-2xl md:text-3xl leading-snug text-balance pt-12 px-4">
                {TESTIMONIALS[0].quote}
              </blockquote>
              <footer className="mt-8 pt-6 border-t border-[var(--color-pib-line)] flex items-center gap-4">
                <Image
                  src={TESTIMONIALS[0].avatar}
                  alt={`${TESTIMONIALS[0].author} testimonial portrait`}
                  width={48}
                  height={48}
                  className="rounded-full object-cover"
                />
                <div>
                  <div className="font-medium">{TESTIMONIALS[0].author}</div>
                  <div className="text-sm text-[var(--color-pib-text-muted)]">{TESTIMONIALS[0].role}</div>
                </div>
              </footer>
            </div>
            <div className="md:col-span-5 grid gap-4 md:gap-5">
              {TESTIMONIALS.slice(1).map((t) => (
                <div key={t.author} className="bento-card">
                  <p className="text-[var(--color-pib-text)] text-pretty">&ldquo;{t.quote}&rdquo;</p>
                  <footer className="mt-4 pt-4 border-t border-[var(--color-pib-line)] flex items-center gap-3 text-sm">
                    <Image
                      src={t.avatar}
                      alt={`${t.author} testimonial portrait`}
                      width={32}
                      height={32}
                      className="rounded-full object-cover"
                    />
                    <div>
                      <div className="font-medium">{t.author}</div>
                      <div className="text-[var(--color-pib-text-muted)] text-xs">{t.role}</div>
                    </div>
                  </footer>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <SectionHead
            eyebrow="Pricing"
            title={<>Honest numbers. No &ldquo;let&rsquo;s talk&rdquo; gatekeeping.</>}
            subtitle="Most projects fall into one of three shapes. Bespoke builds get scoped within three working days."
            href="/pricing"
            cta="See full pricing"
          />
          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            <Link href="/pricing" prefetch={false} className="bento-card group">
              <p className="eyebrow mb-4">Marketing site</p>
              <p className="font-display text-4xl text-[var(--color-pib-text)]">From R35k</p>
              <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">2–4 weeks. Built to be found, built to convert.</p>
            </Link>
            <Link href="/pricing" prefetch={false} className="bento-card relative group" style={{ borderColor: 'rgba(245,166,35,0.4)' }}>
              <span className="absolute -top-2 right-4 pill pill-accent !text-[10px]">Most popular</span>
              <p className="eyebrow mb-4 text-[var(--color-pib-accent)]">Web application</p>
              <p className="font-display text-4xl text-[var(--color-pib-text)]">From R120k</p>
              <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">6–12 weeks. Custom platforms, internal tools, SaaS.</p>
            </Link>
            <Link href="/pricing" prefetch={false} className="bento-card group">
              <p className="eyebrow mb-4">Bespoke build</p>
              <p className="font-display text-4xl text-[var(--color-pib-text)]">Let&rsquo;s scope it</p>
              <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">Strategic engagement. Equity, retainer, or fixed-scope.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* INSIGHTS TEASER */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <SectionHead
            eyebrow="Insights"
            title={<>Build notes &amp; opinions.</>}
            subtitle="Long-form posts on what we learn shipping production software."
            href="/insights"
            cta="All insights"
          />
          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            <Link href="/insights/next-js-16-for-business-websites" prefetch={false} className="bento-card group">
              <span className="pill mb-4 inline-block">Build Notes</span>
              <h3 className="font-display text-2xl mb-3 group-hover:text-[var(--color-pib-accent)] transition-colors text-balance">
                Next.js 16 for business websites: what actually matters
              </h3>
              <p className="text-sm text-[var(--color-pib-text-muted)] text-pretty">A practical look at the Next.js 16 features that move the needle for marketing sites and SaaS.</p>
              <p className="mt-4 font-mono text-xs text-[var(--color-pib-text-faint)]">8 min · 2026-04-12</p>
            </Link>
            <Link href="/insights/building-an-ai-agent-that-bills" prefetch={false} className="bento-card group">
              <span className="pill mb-4 inline-block">Build Notes</span>
              <h3 className="font-display text-2xl mb-3 group-hover:text-[var(--color-pib-accent)] transition-colors text-balance">
                Building an AI agent that actually bills clients
              </h3>
              <p className="text-sm text-[var(--color-pib-text-muted)] text-pretty">How we wired Claude into a South African EFT-first invoicing flow — with proof-of-payment, PayPal fallback, and zero hallucinations.</p>
              <p className="mt-4 font-mono text-xs text-[var(--color-pib-text-faint)]">11 min · 2026-04-02</p>
            </Link>
            <Link href="/insights/south-african-website-cost-2026" prefetch={false} className="bento-card group">
              <span className="pill mb-4 inline-block">Industry POV</span>
              <h3 className="font-display text-2xl mb-3 group-hover:text-[var(--color-pib-accent)] transition-colors text-balance">
                How much does a custom website cost in South Africa in 2026?
              </h3>
              <p className="text-sm text-[var(--color-pib-text-muted)] text-pretty">Honest pricing for marketing sites, web apps, and AI features — with real ZAR ranges.</p>
              <p className="mt-4 font-mono text-xs text-[var(--color-pib-text-faint)]">9 min · 2026-03-21</p>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib max-w-5xl">
          <SectionHead
            eyebrow="Frequently asked"
            title={<>Questions buyers actually ask.</>}
          />
          <FAQ items={FAQ_HOMEPAGE} />
        </div>
      </section>
    </>
  )
}
