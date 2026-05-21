import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { CASE_STUDIES, SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, caseStudySchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'

type Slug = (typeof CASE_STUDIES)[number]['slug']

interface CaseContent {
  contact: { name: string; role: string }
  pullQuote: string
  outcomeQuote: { quote: string; author: string; role: string; avatar: string }
  visuals: [string, string]
  brief: string
  insight: string
  build: string
  shipped: string[]
}

const CONTENT: Record<Slug, CaseContent> = {
  athleet: {
    contact: { name: 'Daniel Roux', role: 'Co-founder, Athleet' },
    pullQuote:
      'Our admins were running a club out of WhatsApp screenshots and a 14-tab spreadsheet. We needed a backbone, not another app.',
    outcomeQuote: {
      quote:
        'Pip and the team rebuilt our entire platform in 6 weeks. We shipped what our last vendor took 9 months to half-finish — and our coaches actually use it.',
      author: 'Daniel Roux',
      role: 'Co-founder, Athleet',
      avatar: '/images/case-athleet-cover.jpg',
    },
    visuals: ['/images/case-athleet-ops.jpg', '/images/case-athleet-cover.jpg'],
    brief:
      'Athleet came to us with a problem most growing sports clubs share but rarely articulate well: their administrative spine was held together with WhatsApp groups, a scattering of Google Sheets, and the occasional PDF emailed at 11pm. Coaches were re-typing rosters. Parents were asking the same questions every week. Membership numbers had quietly tripled in eighteen months and the cracks were now structural. They had tried two off-the-shelf club platforms before us — both built for North-American leagues with rigid season models that did not match how a South African club actually runs. The brief was deceptively simple: build the system we should have started with three years ago, and make it boring enough that admins trust it on day one.',
    insight:
      'The breakthrough was reframing what a club actually is. Most platforms in this space model a club as a workflow engine — registrations, payments, attendance — and bolt content on as an afterthought. We argued the opposite. A club is fundamentally a content management system: athletes, teams, sessions, parents, sponsors are all entities you publish, edit, and relate. Workflow is just the verb that ties them together. Once we accepted that framing, the data model collapsed from forty-seven tables in their previous vendor&apos;s schema to fourteen. Subdomains per club became cheap. Onboarding a new club went from a week of configuration to a ten-step wizard a coach can finish on a Sunday afternoon.',
    build:
      'We built Athleet as a multi-tenant Next.js 16 application backed by Firebase, with a per-club subdomain model and a single shared codebase. Firestore handles the operational data with composite indexes per tenant; Cloud Functions handle the heavier work — invoice generation, attendance roll-ups, automated WhatsApp reminders. Every club gets its own brand profile (logo, colors, voice) which the marketing pages and parent-facing emails consume directly, so the platform never feels white-labelled in the cheap sense. The 10-step onboarding wizard was the unlock: it asks the right questions in the right order, defaults intelligently from the club&apos;s sport and size, and produces a usable platform at the end. We also shipped a mobile companion via Capacitor so coaches can mark attendance pitch-side without unlocking a laptop. The whole thing went live for the first three pilot clubs in under four weeks from kickoff.',
    shipped: [
      'Multi-tenant Next.js 16 platform with per-club subdomains',
      'Firestore data layer with tenant-scoped composite indexes',
      '10-step onboarding wizard for new clubs',
      'Coach mobile app via Capacitor for pitch-side attendance',
      'Automated parent comms via Resend + WhatsApp Cloud API',
      'Per-club brand profile + theming system',
      'Admin analytics dashboard with retention and revenue metrics',
    ],
  },
  'loyalty-plus': {
    contact: { name: 'Sarah van Niekerk', role: 'Head of Product, Loyalty Plus' },
    pullQuote:
      'The app took eight seconds to load on a good day and crashed every time someone scrolled the rewards list on iPhone. Our enterprise customers were embarrassed to demo it.',
    outcomeQuote: {
      quote:
        'They write code like grown-ups. No stubs, no "we will fix it in v2", no surprises in the invoice. The cutover happened on a Wednesday afternoon and nobody noticed except our analytics dashboard.',
      author: 'Sarah van Niekerk',
      role: 'Head of Product, Loyalty Plus',
      avatar: '/images/case-loyaltyplus-cover.jpg',
    },
    visuals: ['/images/case-loyaltyplus-mobile.jpg', '/images/case-loyaltyplus-cover.jpg'],
    brief:
      'Loyalty Plus runs the loyalty programmes for a portfolio of aviation clients — airlines, MROs, and ground service providers across three continents. Their platform was ten years old and showing every one of those years. The original Angular 4 codebase had been patched, forked, half-migrated to Angular 8, then frozen. Initial page loads averaged eight seconds on cellular, the iOS Cordova wrapper crashed on long lists, and any new feature took six weeks of cautious archaeology before code could be written. The brief was unambiguous: modernise the front-end without touching the data layer their enterprise customers had built integrations against, and do it without a single minute of customer-facing downtime.',
    insight:
      'The temptation when you inherit a legacy front-end is to rewrite the whole stack. We argued against it. The data layer — a stable, well-tested set of REST APIs and a Firestore-backed warehouse — was actually the strongest asset Loyalty Plus owned. Twelve enterprise customers had built integrations against it. Touching it would have triggered a year of contract renegotiations. The right move was a strict perimeter rewrite: replace the front-end and the mobile shell, leave the API surface untouched, and use the rebuild as an excuse to extract a shared services layer that the web and mobile clients could both consume cleanly.',
    build:
      'We rebuilt the front-end as an Angular 17 + Ionic 7 + Capacitor monorepo, with a shared services package that both the web app and the iOS/Android shells consume. The cutover ran behind a feature flag at the CDN layer — old and new versions served side-by-side for two weeks, with a kill-switch we never needed to use. Page loads dropped from eight seconds to under two on the same network. The Capacitor build replaced the brittle Cordova shell and unlocked native push notifications and biometric login, both of which two of their largest customers had been asking for since 2022. We also took the opportunity to instrument every meaningful interaction with @partnersinbiz/analytics-js so the product team could finally answer "are people actually using the rewards browser?" with a number instead of a guess. Total elapsed time, kickoff to full cutover: nine weeks.',
    shipped: [
      'Angular 17 + Ionic 7 web application',
      'iOS and Android apps via Capacitor with native push and biometrics',
      'Shared services monorepo package consumed by web and mobile',
      'Feature-flagged CDN cutover with zero customer-facing downtime',
      'Product analytics instrumentation across all flows',
      'Performance budget enforced in CI (LCP under 2s)',
      'Migration runbook + rollback playbook handed to internal team',
    ],
  },
  'ahs-law': {
    contact: { name: 'Adv. Hendrik Steyn', role: 'Director, AHS Law' },
    pullQuote:
      'Clients were finding our competitors before they found us, and the ones who did find us were emailing PDFs back and forth like it was 2009. We needed both fixed.',
    outcomeQuote: {
      quote:
        'Within two months we were ranking number one for our primary practice area in Cape Town, and our paralegals stopped spending half their week chasing document signatures. The portal alone paid for the project.',
      author: 'Adv. Hendrik Steyn',
      role: 'Director, AHS Law',
      avatar: '/images/case-ahs-law-cover.jpg',
    },
    visuals: ['/images/case-ahs-law-portal.jpg', '/images/case-ahs-law-cover.jpg'],
    brief:
      'AHS Law is a boutique commercial litigation and corporate advisory firm in Cape Town. They came to us with two problems that turned out to be the same problem. The marketing site, built years earlier on a generic WordPress theme, was ranking nowhere — competitors with half the credentials sat above them on every primary search term. And client document exchange happened via email, with the inevitable 30MB PDFs bouncing off Gmail limits and partners having no audit trail of what had been signed when. The directors did not want a brochure refresh. They wanted measurable inbound and a client experience that matched the standard of work they delivered.',
    insight:
      'Lawyers are sold on trust signals — and trust signals, online, reduce to two things: proof and speed. Proof means real cases, real outcomes, real contributors with names and photos, structured for both humans and Google. Speed means the page renders before the prospect&apos;s patience does. Most law firm sites get neither right. They hide their best work behind generic "Our Expertise" pages and ship 4MB hero images. We treated the marketing site as a reputation engine first and a brochure second — and we treated the client portal as a billable feature, not a cost centre.',
    build:
      'The marketing site is a Vite + React + TypeScript build with Tailwind v4, statically rendered and served from Vercel&apos;s edge. Every practice area has its own deeply structured page with schema.org markup, real case summaries, and named author bios with bar admission dates — the kind of content Google&apos;s helpful-content updates reward. The client portal is a separate Firebase Auth + Firestore application: clients log in, see their matters, upload documents to a write-only intake bucket, and receive notifications when their attorney has reviewed something. Documents are versioned, audit-logged, and signable inline via a third-party e-signature integration. Mobile LCP came in at 1.4 seconds on 4G. Within eight weeks of launch the firm was ranking number one organic for its primary practice term in its city, and inbound enquiries had doubled.',
    shipped: [
      'Vite + React + TypeScript marketing site, statically rendered',
      'Per-practice-area pages with full schema.org structured data',
      'Firebase Auth + Firestore secure client document portal',
      'Document versioning and audit logging',
      'E-signature integration for matter sign-offs',
      'Editorial brand system + photography direction',
      'Analytics + GA4 conversion tracking on all enquiry forms',
    ],
  },
  scrolledbrain: {
    contact: { name: 'Marcus Lin', role: 'Founder, Scrolled Brain' },
    pullQuote:
      'PostHog was costing us more per month than our hosting and answering the wrong questions. I needed to know which onboarding step was killing conversion, not how many people scrolled past the fold.',
    outcomeQuote: {
      quote:
        'Day one in production we had funnel data nobody else in the speed-reading category has. Day thirty we had answers I would have been guessing at for six months on the old stack.',
      author: 'Marcus Lin',
      role: 'Founder, Scrolled Brain',
      avatar: '/images/case-scrolledbrain-cover.jpg',
    },
    visuals: ['/images/case-scrolledbrain-dashboard.jpg', '/images/case-scrolledbrain-cover.jpg'],
    brief:
      'Scrolled Brain is a speed-reading and focus platform aimed at students and knowledge workers. The founder came to us with a marketing site that was technically functional but converting poorly, and an analytics bill on PostHog that was eating more than fifteen percent of monthly revenue. Worse, the data PostHog was collecting did not actually answer the questions the team needed to make product decisions. The brief had two halves: rebuild the marketing site as a serious conversion surface, and build a custom analytics stack that costs a fraction of what they were paying and tells them exactly which onboarding step is bleeding users.',
    insight:
      'Generic product analytics tools are priced for a use case most early-stage products do not actually have. They charge per event, which means you instrument less than you should because every track call has a cost. They give you a hundred dashboards you will never look at and none of the three you need. For a focused product with a small number of critical funnels, a custom analytics stack — built on Firestore and a small Next.js dashboard — costs almost nothing to run and answers the actual questions an order of magnitude faster. The marketing site was the same insight in a different shape: stop optimising for vanity metrics and start measuring sign-ups.',
    build:
      'The marketing site is Next.js 16 with the App Router, statically generated where possible and edge-rendered where not, with hero copy and pricing structured around the three concrete benefits of the product rather than the technology behind it. The custom analytics stack is shipped as a small browser SDK — @partnersinbiz/analytics-js — that batches events to a serverless ingestion endpoint, deduplicates by session, and writes to a Firestore collection with composite indexes for funnel queries. A small internal dashboard in the same Next.js codebase visualises funnels, retention, and live event streams. Mobile Lighthouse came in at 94 on the marketing site at launch, the analytics stack was in production from day one, and the sign-up conversion rate on the new homepage settled at 38% — almost three times the previous baseline.',
    shipped: [
      'Next.js 16 App Router marketing site with edge rendering',
      'Conversion-focused homepage, pricing, and onboarding pages',
      '@partnersinbiz/analytics-js browser SDK',
      'Serverless analytics ingestion + Firestore event store',
      'Internal funnel + retention dashboard',
      'Live event stream view for the founder',
      'GDPR-compliant data purge endpoint',
    ],
  },
}

export function generateStaticParams() {
  return CASE_STUDIES.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const study = CASE_STUDIES.find((c) => c.slug === slug)
  if (!study) return { title: 'Case study not found | Partners in Biz' }

  const title = `${study.client} — ${study.headline} | Case study`
  const description = study.summary

  return {
    title,
    description,
    alternates: { canonical: study.href },
    openGraph: {
      title,
      description,
      url: `${SITE.url}${study.href}`,
      type: 'article',
      images: [{ url: study.cover, width: 1200, height: 630, alt: study.client }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [study.cover],
    },
  }
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const idx = CASE_STUDIES.findIndex((c) => c.slug === slug)
  if (idx === -1) notFound()

  const study = CASE_STUDIES[idx]
  const next = CASE_STUDIES[(idx + 1) % CASE_STUDIES.length]
  const content = CONTENT[study.slug as Slug]

  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: '/' },
          { name: 'Work', url: '/work' },
          { name: study.client, url: study.href },
        ])}
      />
      <JsonLd
        data={caseStudySchema({
          slug: study.href.replace(/^\//, ''),
          title: study.headline,
          description: study.summary,
          image: study.cover,
          client: study.client,
          datePublished: `${study.year}-01-01`,
        })}
      />

      <main>
        {/* Hero */}
        <section className="relative pt-40 pb-16 md:pb-24 overflow-hidden">
          <div className="absolute inset-0 pib-mesh opacity-60 pointer-events-none" />
          <div className="container-pib relative">
            <Reveal>
              <Link
                href="/work"
                className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-8"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                All work
              </Link>
              <p className="eyebrow mb-6">
                Case study <span className="opacity-60">/ {study.industry}</span>
              </p>
              <h1 className="h-display text-balance max-w-5xl">{study.headline}</h1>
              <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
                {study.summary}
              </p>
            </Reveal>

            {/* Context strip */}
            <Reveal delay={140}>
              <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-pib-line)] rounded-2xl overflow-hidden border border-[var(--color-pib-line)]">
                {[
                  { k: 'Client', v: study.client },
                  { k: 'Industry', v: study.industry },
                  { k: 'Year', v: study.year },
                  { k: 'Stack', v: study.stack.slice(0, 2).join(' · ') },
                ].map((item) => (
                  <div key={item.k} className="bg-[var(--color-pib-surface)] p-5 md:p-6">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)] mb-2">
                      {item.k}
                    </div>
                    <div className="font-display text-xl md:text-2xl">{item.v}</div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* Cover image */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib">
            <Reveal>
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                <Image
                  src={study.cover}
                  alt={`${study.client} cover`}
                  fill
                  priority
                  sizes="(min-width: 1280px) 1200px, 100vw"
                  className="object-cover"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* The Brief */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
            <div className="md:col-span-4">
              <p className="eyebrow mb-4">01 — The Brief</p>
              <h2 className="h-display text-balance">A real problem.</h2>
            </div>
            <div className="md:col-span-8">
              <Reveal>
                <p className="text-lg md:text-xl leading-relaxed text-[var(--color-pib-text)]/90 text-pretty">
                  {content.brief}
                </p>
              </Reveal>
              <Reveal delay={140}>
                <blockquote className="mt-12 border-l-2 border-[var(--color-pib-accent)] pl-6 md:pl-8">
                  <p className="font-display italic text-2xl md:text-4xl leading-[1.15] text-balance">
                    &ldquo;{content.pullQuote}&rdquo;
                  </p>
                  <footer className="mt-5 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                    {content.contact.name} · {content.contact.role}
                  </footer>
                </blockquote>
              </Reveal>
            </div>
          </div>
        </section>

        {/* The Insight */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
            <div className="md:col-span-4">
              <p className="eyebrow mb-4">02 — The Insight</p>
              <h2 className="h-display text-balance">What we saw.</h2>
            </div>
            <div className="md:col-span-8">
              <Reveal>
                <p className="text-lg md:text-xl leading-relaxed text-[var(--color-pib-text)]/90 text-pretty">
                  {content.insight}
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* The Build */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
            <div className="md:col-span-4">
              <p className="eyebrow mb-4">03 — The Build</p>
              <h2 className="h-display text-balance">What we shipped.</h2>
            </div>
            <div className="md:col-span-8">
              <Reveal>
                <p className="text-lg md:text-xl leading-relaxed text-[var(--color-pib-text)]/90 text-pretty">
                  {content.build}
                </p>
              </Reveal>
              <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
                {content.visuals.map((src, i) => (
                  <Reveal key={src} delay={i * 100}>
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                      <Image
                        src={src}
                        alt={`${study.client} build visual ${i + 1}`}
                        fill
                        sizes="(min-width: 768px) 40vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* The Outcome */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
              <div className="md:col-span-4">
                <p className="eyebrow mb-4">04 — The Outcome</p>
                <h2 className="h-display text-balance">What changed.</h2>
              </div>
              <div className="md:col-span-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5">
                  {study.metrics.map((m, i) => (
                    <Reveal key={m.label} delay={i * 100}>
                      <div className="bento-card h-full">
                        <div className="font-display text-5xl md:text-6xl leading-none mb-3">
                          {m.value}
                        </div>
                        <div className="text-sm text-[var(--color-pib-text-muted)]">{m.label}</div>
                      </div>
                    </Reveal>
                  ))}
                </div>

                <Reveal delay={300}>
                  <figure className="mt-10 bento-card">
                    <div className="flex items-start gap-5">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-[var(--color-pib-line-strong)]">
                        <Image
                          src={content.outcomeQuote.avatar}
                          alt={content.outcomeQuote.author}
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <p className="font-display italic text-xl md:text-2xl leading-snug text-pretty">
                          &ldquo;{content.outcomeQuote.quote}&rdquo;
                        </p>
                        <figcaption className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                          {content.outcomeQuote.author} · {content.outcomeQuote.role}
                        </figcaption>
                      </div>
                    </div>
                  </figure>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* What we shipped */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16">
            <div className="md:col-span-4">
              <p className="eyebrow mb-4">05 — Deliverables</p>
              <h2 className="h-display text-balance">What we shipped.</h2>
            </div>
            <div className="md:col-span-8">
              <ul className="divide-y divide-[var(--color-pib-line)] border-y border-[var(--color-pib-line)]">
                {content.shipped.map((item, i) => (
                  <li
                    key={item}
                    className="flex items-start gap-5 py-5 md:py-6"
                  >
                    <span className="font-mono text-xs text-[var(--color-pib-text-muted)] mt-1.5 w-8 shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-base md:text-lg text-[var(--color-pib-text)]/90">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib">
            <p className="eyebrow mb-6">06 — Stack</p>
            <h2 className="h-display text-balance mb-10">The tools.</h2>
            <div className="flex flex-wrap gap-3">
              {study.stack.map((s) => (
                <span key={s} className="pill text-sm py-2 px-4">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Next case */}
        <section className="pb-24 md:pb-32">
          <div className="container-pib">
            <Link
              href={next.href}
              className="group block bento-card relative overflow-hidden p-10 md:p-16"
            >
              <div className="absolute inset-0 pib-mesh opacity-50 pointer-events-none" />
              <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="eyebrow mb-4">Next case</p>
                  <h2 className="h-display text-balance max-w-3xl">{next.headline}</h2>
                  <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                    {next.client} · {next.industry}
                  </p>
                </div>
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[var(--color-pib-line-strong)] transition-all group-hover:bg-[var(--color-pib-accent)] group-hover:border-[var(--color-pib-accent)] group-hover:text-black group-hover:translate-x-2">
                  <span className="material-symbols-outlined text-3xl">arrow_forward</span>
                </span>
              </div>
            </Link>
          </div>
        </section>

        {/* CTA strip */}
        <section className="pb-32">
          <div className="container-pib">
            <div className="hairline pt-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <p className="font-display text-2xl md:text-3xl text-balance max-w-xl">
                Want a case study like this one — with your name on it?
              </p>
              <Link href="/start-a-project" className="btn-pib-accent self-start">
                Start a project
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
