import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE, CTA_LABEL } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema, serviceSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import { SectionHead } from '@/components/marketing/SectionHead'
import { FAQ } from '@/components/marketing/FAQ'

export const metadata: Metadata = {
  title: 'Properties, Control plane for your client websites & apps',
  description:
    'Update store URLs, run feature flags, see real analytics, and trigger nurture sequences for any client website without redeploys.',
  alternates: { canonical: '/properties' },
  openGraph: {
    title: 'Properties, the control plane your client\'s site never had',
    description:
      'Update store URLs, run feature flags, see real analytics, and trigger nurture sequences for any client website without redeploys.',
    url: `${SITE.url}/properties`,
    type: 'website',
    images: ['/og/default.png'],
  },
}

const FEATURES = [
  {
    icon: 'tune',
    title: 'Remote config',
    body: 'Update App Store URLs, primary CTAs, custom JSON without a redeploy.',
    before: 'Dev ticket + redeploy',
    after: '30s in PiB',
  },
  {
    icon: 'power_settings_new',
    title: 'Kill switch',
    body: 'Toggle a property offline instantly when something goes wrong.',
    before: 'Frantic hosting call',
    after: 'One click',
  },
  {
    icon: 'flag',
    title: 'Feature flags',
    body: 'Roll a feature to a cohort, measure, then expand. No redeploy needed.',
    before: 'Not possible without ship',
    after: 'Live A/B',
  },
  {
    icon: 'analytics',
    title: 'Per-property analytics',
    body: 'Sessions, users, events, conversions, and a live event stream.',
    before: 'Vague GA share',
    after: 'Real dashboard',
  },
  {
    icon: 'mail',
    title: 'Conversion sequences',
    body: 'Auto-enrol converters into a linked email nurture sequence.',
    before: 'Manual contact import',
    after: 'Linked sequence',
  },
  {
    icon: 'link',
    title: 'Creator / affiliate links',
    body: 'Property-scoped short URLs with click counts and attribution.',
    before: 'Honour-system reporting',
    after: 'Tracked attribution',
  },
] as const

const STEPS = [
  {
    step: '01',
    title: 'Drop the ingest key',
    body: 'A single env var in your client\'s site or app. The lightweight @partnersinbiz/analytics-js SDK does the rest.',
  },
  {
    step: '02',
    title: 'Configure in PiB',
    body: 'Set store URLs, primary CTAs, kill switches, feature flags, and the linked email sequence, from one dashboard.',
  },
  {
    step: '03',
    title: 'Measure & iterate',
    body: 'Watch real sessions stream in. Flip a flag, ship a config change, see the lift, without a single deploy.',
  },
] as const

const CAPABILITIES = [
  {
    q: 'Runtime config',
    a: 'Each property exposes a JSON config block read by the client at runtime. Change the App Store URL, the primary CTA href, the announcement banner copy, or any custom field, your client\'s site picks it up on the next request, no redeploy needed.',
  },
  {
    q: 'Kill switch',
    a: 'Every property has a global kill switch. Flip it and the property\'s SDK serves a maintenance shell instead of the live site. Useful during incidents, takedowns, or planned outages, no DNS surgery, no panicked hosting calls.',
  },
  {
    q: 'Feature flags',
    a: 'Boolean and JSON flags scoped per property and per cohort. Roll a feature to 5% of traffic, watch the conversion delta, and either expand or roll back from the same dashboard. The SDK caches and revalidates so flags are fast in production.',
  },
  {
    q: 'Analytics',
    a: 'A first-party analytics pipeline with sessions, users, events, funnels, and a live event stream. Each property gets its own dashboard so your client sees their numbers, not yours, not aggregated, not second-hand from GA.',
  },
  {
    q: 'Conversion sequences',
    a: 'Wire any conversion event to a linked email sequence. The contact is auto-enrolled into the sequence on the event, with the property\'s context attached. No CSV exports, no Zapier glue.',
  },
  {
    q: 'Creator & affiliate links',
    a: 'Property-scoped short URLs with click counts, referrer attribution, and per-creator dashboards. Pay creators on real, attributable clicks, not the honour system.',
  },
] as const

const FAQS = [
  {
    q: 'Do I need a developer to wire this up?',
    a: 'For the first property, yes, a developer drops the ingest key into the env and the SDK into the client\'s site. After that everything is dashboard-driven. Most agencies wire it once and reuse the pattern across every client site they ship.',
  },
  {
    q: 'Will Properties break my client\'s site?',
    a: 'No. The SDK fails open: if PiB is unreachable the site falls back to its build-time defaults. Nothing in Properties is on your client\'s critical render path.',
  },
  {
    q: 'Can my client see this dashboard?',
    a: 'Yes. Each client org gets read-only access to their own property dashboards. You control what they see, analytics, conversions, or the full config plane.',
  },
  {
    q: 'What about Google Analytics?',
    a: 'Keep GA if you want it, Properties analytics runs alongside, not instead. Most agencies keep GA for the marketing team and use Properties for the operational and product view.',
  },
  {
    q: 'Is it GDPR / POPIA compliant?',
    a: 'Yes. The SDK is cookieless by default, IPs are hashed at ingest, and per-property data export and deletion are one click. You stay in control of the data.',
  },
  {
    q: 'What does the kill switch actually do?',
    a: 'When the kill switch is on, the SDK serves a configurable maintenance shell instead of the live site. The shell is fully customisable per property, your branding, your copy, your retry behaviour.',
  },
] as const

export default function PropertiesPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Properties', url: '/properties' },
  ])
  const service = serviceSchema({
    slug: 'properties',
    name: 'Properties, Runtime control plane',
    description:
      'A runtime control plane for client websites and apps: remote config, kill switch, feature flags, per-property analytics, and linked email sequences.',
  })
  const faq = faqSchema([...FAQS])

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={service} />
      <JsonLd data={faq} />

      {/* Hero */}
      <section className="relative pt-28 md:pt-40 pb-20 md:pb-24 overflow-hidden">
        <div className="absolute inset-0 pib-mesh pointer-events-none" />
        <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-40" />
        <div className="container-pib relative">
          <Reveal>
            <p className="eyebrow mb-6">
              <span className="text-[var(--color-pib-accent)]">Properties</span>
              <span className="mx-2 text-[var(--color-pib-text-faint)]">·</span>
              <span>New</span>
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="h-display text-balance max-w-[20ch]">
              The control plane your client&rsquo;s site never had.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-8 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
              Properties is the runtime layer for every site and app we ship. Update store URLs, flip
              feature flags, see real analytics, and trigger nurture sequences, all without a single
              redeploy. One dashboard for every client surface.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href={SITE.cal.url} className="btn-pib-accent">
                {CTA_LABEL}
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href="/pricing#properties" className="btn-pib-secondary">
                See pricing
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Problem */}
      <section className="section pt-0">
        <div className="container-pib">
          <SectionHead
            eyebrow="The problem"
            title="Every client change is a dev ticket."
          />
          <div className="grid md:grid-cols-3 gap-5 md:gap-6">
            <Reveal>
              <div className="bento-card h-full p-7">
                <p className="text-[var(--color-pib-text)] text-pretty">
                  The App Store URL changes. The hero CTA needs to swap. A campaign banner has to go
                  live by Friday. Every one of those is a dev ticket, a redeploy, and a chunk of your
                  margin.
                </p>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="bento-card h-full p-7">
                <p className="text-[var(--color-pib-text)] text-pretty">
                  Analytics is scattered across GA, a spreadsheet someone updates manually, and a
                  Slack channel where wins get screenshotted. Nobody can answer &ldquo;is this site
                  actually working?&rdquo; in under an hour.
                </p>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="bento-card h-full p-7">
                <p className="text-[var(--color-pib-text)] text-pretty">
                  Traffic converts on the marketing site, and then nothing happens. There is no
                  bridge from a form fill on the live site to the nurture sequence that closes the
                  deal. Leads cool off in a CSV.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* What you can do */}
      <section className="section pt-0">
        <div className="container-pib">
          <SectionHead
            eyebrow="What you can do"
            title="Six jobs, one dashboard."
            subtitle="The before / after of every Properties capability, written in the JTBD shape because that is how agencies actually think about this work."
          />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <div className="bento-card h-full p-7 flex flex-col gap-4">
                  <span
                    className="material-symbols-outlined text-[var(--color-pib-accent)]"
                    style={{ fontSize: '32px', fontVariationSettings: "'FILL' 0, 'wght' 300" }}
                  >
                    {f.icon}
                  </span>
                  <h2 className="font-display text-xl text-[var(--color-pib-text)]">{f.title}</h2>
                  <p className="text-[var(--color-pib-text-muted)] text-pretty leading-relaxed flex-1">
                    {f.body}
                  </p>
                  <div className="mt-2 pt-4 border-t border-[var(--color-pib-line)] font-mono text-[11px] text-[var(--color-pib-text-faint)] leading-relaxed">
                    <div>before: {f.before}</div>
                    <div>after: <span className="text-[var(--color-pib-accent)]">{f.after}</span></div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section pt-0">
        <div className="container-pib">
          <SectionHead
            eyebrow="How it works"
            title="Three steps, then it is live."
          />
          <div className="grid md:grid-cols-3 gap-5 md:gap-6">
            {STEPS.map((s, i) => (
              <Reveal key={s.step} delay={i * 80}>
                <div className="bento-card h-full p-8 flex flex-col gap-4">
                  <span className="font-mono text-xs tracking-widest text-[var(--color-pib-accent)]">
                    {s.step}
                  </span>
                  <h2 className="font-display text-2xl text-[var(--color-pib-text)]">{s.title}</h2>
                  <p className="text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Capability deep-dive */}
      <section className="section pt-0">
        <div className="container-pib max-w-5xl">
          <SectionHead
            eyebrow="Capability deep-dive"
            title="What each capability actually does."
            subtitle="The detail behind the six headlines. Skip what you do not need."
          />
          <FAQ items={CAPABILITIES} />
        </div>
      </section>

      {/* Built for agencies */}
      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="bento-card p-10 md:p-14 grid grid-cols-1 lg:grid-cols-12 gap-10">
              <div className="lg:col-span-5">
                <p className="eyebrow mb-4">Built for agencies</p>
                <h2 className="h-display text-3xl md:text-4xl text-balance">
                  Built for the <span className="text-[var(--color-pib-accent)]">agency model.</span>
                </h2>
                <p className="mt-6 text-[var(--color-pib-text-muted)] text-pretty">
                  Multi-org from day one. Every client gets their own workspace, their own
                  property dashboards, and their own white-labelled reports, without you spinning
                  up another tool per client.
                </p>
              </div>
              <div className="lg:col-span-7">
                <ul className="space-y-3">
                  {[
                    'Multi-org workspaces, one PiB account, every client cleanly separated.',
                    'Per-property dashboards your clients can actually log in to.',
                    'White-label monthly reports baked in, branded for you, sent to them.',
                    'Read-only client roles, full-access internal roles, audit log on every change.',
                    'Drop-in SDK that works with Next.js, Vite, plain HTML, React Native, and Expo.',
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[var(--color-pib-accent)] mt-0.5 shrink-0">
                        check_circle
                      </span>
                      <span className="text-pretty">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section pt-0">
        <div className="container-pib max-w-5xl">
          <SectionHead
            eyebrow="FAQ"
            title="Questions buyers ask before they wire it in."
          />
          <FAQ items={FAQS} />
        </div>
      </section>

      {/* Final CTA */}
      <section className="section pt-0">
        <div className="container-pib">
          <Reveal>
            <div className="bento-card p-10 md:p-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="max-w-xl">
                <p className="eyebrow mb-3">Ready?</p>
                <h2 className="h-display text-3xl md:text-4xl text-balance">
                  Ready to take control of your client surfaces?
                </h2>
                <p className="mt-4 text-[var(--color-pib-text-muted)] text-pretty">
                  Properties ships with every Web Application and Bespoke Build. Or wire it into a
                  site we did not build, we&rsquo;ll quote the integration in a day.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <Link href={SITE.cal.url} className="btn-pib-accent">
                  {CTA_LABEL}
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  )
}
