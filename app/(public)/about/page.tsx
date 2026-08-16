import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { SITE, TECH_STACK } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'

export const metadata: Metadata = {
  title: 'About — Founder-led software studio in Pretoria',
  description:
    'Partners in Biz is a Pretoria-based studio led by Peet Stander. We build websites, web apps, mobile apps, and AI integrations that ship — and keep working.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About Partners in Biz',
    description:
      'Founder-led software studio in Pretoria. Boring tooling, brave decisions. EFT-first, no vendor lock-in.',
    url: `${SITE.url}/about`,
    type: 'profile',
    images: ['/images/peet-stander.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Partners in Biz',
    description: 'Founder-led software studio in Pretoria.',
  },
}

const MANIFESTO = [
  {
    n: '01',
    title: 'Real code, not stubs.',
    body:
      'No "we\'ll fix it in v2." Every commit is production-grade from day one. If a feature is in the scope, it works in the scope — typed, tested, and live on a Vercel preview before you see it.',
  },
  {
    n: '02',
    title: 'Yours, not ours.',
    body:
      'Your GitHub, your Vercel, your Firebase, your domains. We don\'t white-label our infrastructure or rent you back your own product. The day after launch, you can fire us and nothing breaks.',
  },
  {
    n: '03',
    title: 'EFT-first.',
    body:
      'South African banking works. We invoice in ZAR, accept EFT as the default, and only reach for PayPal or international cards when the client is offshore. We don\'t add a 3% card-processing tax to local invoices.',
  },
  {
    n: '04',
    title: 'Boring tooling, brave decisions.',
    body:
      'Next.js, Tailwind, Postgres, Firebase. Tools that will still be supported in five years. Then we go big on the things that actually matter — AI integrations, novel UX, real product strategy.',
  },
  {
    n: '05',
    title: 'The same person from quote to launch.',
    body:
      'No bait-and-switch from a sales lead to a junior dev. The person who scopes the work writes the code, sends the invoice, and answers the WhatsApp. There is no "account team" because there is no account team.',
  },
] as const

const BTS = [
  { src: '/images/process-discover.jpg', label: 'Writing the brief', caption: 'Week 0 — discovery and scope' },
  { src: '/images/process-design.jpg', label: 'Design review', caption: 'Figma, in-context, with you' },
  { src: '/images/process-build.jpg', label: 'Building', caption: 'Code, tickets, and previews moving daily' },
  { src: '/images/process-launch.jpg', label: 'Launch day', caption: 'DNS, analytics, monitoring — live' },
] as const

const ENGAGEMENTS = [
  {
    name: 'Project',
    blurb: 'Fixed scope, fixed price, fixed launch date.',
    body:
      'You know what you need built. We scope it, ship it, and hand it over. EFT 50/50 — half on signature, half on launch. Most engagements: 4–12 weeks.',
    badge: 'From R35k',
  },
  {
    name: 'Retainer',
    blurb: 'Ongoing engineering on tap.',
    body:
      'For teams who already shipped v1 and need someone to keep shipping. Monthly retainer covering hosting, monitoring, and 8–20 hours of dev work. Cancel any month.',
    badge: 'From R15k/mo',
  },
  {
    name: 'Advisory',
    blurb: 'For when you have a team but need a brain.',
    body:
      'Architecture review, AI feature design, hiring loops, vendor selection. Hourly or per-engagement. We slot in alongside your existing team without owning the codebase.',
    badge: 'From R950/hr',
  },
] as const

export default function AboutPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'About', url: '/about' },
  ])

  return (
    <main className="bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
      <JsonLd data={breadcrumbs} />

      {/* HERO */}
      <section className="relative pt-32 md:pt-44 pb-20 md:pb-28 overflow-hidden">
        <div className="absolute inset-0 pib-mesh pointer-events-none" aria-hidden />
        <div className="absolute inset-0 pib-grid-bg pointer-events-none opacity-60" aria-hidden />
        <div className="container-pib relative">
          <Reveal>
            <p className="eyebrow mb-6">About — est. {SITE.founded}</p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="h-display text-balance max-w-5xl">
              We build software the way it should be built. Boring, on-time, and yours.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-8 text-lg md:text-xl text-[var(--color-pib-text-muted)] max-w-2xl text-pretty leading-relaxed">
              Partners in Biz is a Pretoria-based studio led by Peet Stander. We make websites,
              web apps, mobile apps, and AI integrations that ship — and keep working.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/work" className="btn-pib-primary">
                See the work
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href="/start-a-project" className="btn-pib-secondary">
                Start a project
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FOUNDER */}
      <section id="founder" className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-5">
            <Reveal>
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[20px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                <Image
                  src="/images/peet-stander.jpg"
                  alt="Peet Stander, Founder of Partners in Biz"
                  fill
                  sizes="(max-width: 1024px) 100vw, 40vw"
                  className="object-cover grayscale-[15%]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between">
                  <div>
                    <p className="font-display text-2xl leading-none">{SITE.founder.name}</p>
                    <p className="eyebrow mt-2">{SITE.founder.role}</p>
                  </div>
                  <span className="pill pill-accent">Pretoria</span>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <Reveal delay={80}>
              <p className="eyebrow mb-5">A note from the founder</p>
            </Reveal>
            <Reveal delay={120}>
              <h2 className="h-display text-balance">
                I started this so I could send the invoice and answer the WhatsApp.
              </h2>
            </Reveal>

            <div className="mt-10 space-y-7 text-lg leading-relaxed text-[var(--color-pib-text-muted)] text-pretty max-w-2xl">
              <Reveal delay={160}>
                <p>
                  I started Partners in Biz because most agency engagements I&apos;d seen were
                  either too expensive, too slow, or too detached from the actual business
                  outcome. Three-month discovery phases. Junior devs with a senior price tag.
                  Status decks instead of working software.
                </p>
              </Reveal>

              <Reveal delay={200}>
                <blockquote className="font-display italic text-2xl md:text-3xl leading-snug text-[var(--color-pib-text)] border-l-2 border-[var(--color-pib-accent)] pl-6 my-10">
                  &ldquo;The promise is simple. I write the code, I send the invoice, I answer
                  the WhatsApp. The same person, from the first call to the launch announcement.&rdquo;
                </blockquote>
              </Reveal>

              <Reveal delay={240}>
                <p>
                  We&apos;re built around a deliberate wedge: based in South Africa, working at
                  a global standard, invoicing EFT-first because local banking works just fine.
                  No Stripe-tax on local clients, no vendor lock-in, no hand-off from sales to
                  a stranger.
                </p>
              </Reveal>

              <Reveal delay={280}>
                <p>
                  The work I take on is the work I can stand behind. If a project isn&apos;t the
                  right fit — for budget, for timeline, for outcome — I&apos;ll tell you on the
                  first call and recommend someone better. The goal isn&apos;t to win the brief.
                  The goal is to ship something that earns its keep.
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="section border-t border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/30">
        <div className="container-pib">
          <div className="max-w-3xl mb-16 md:mb-20">
            <Reveal>
              <p className="eyebrow mb-5">What we believe</p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="h-display text-balance">
                Five things we won&apos;t compromise on.
              </h2>
            </Reveal>
          </div>

          <ol className="divide-y divide-[var(--color-pib-line)] border-y border-[var(--color-pib-line)]">
            {MANIFESTO.map((item, i) => (
              <Reveal key={item.n} delay={i * 60} as="li">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 py-10 md:py-14">
                  <div className="md:col-span-2">
                    <span className="font-display text-5xl md:text-6xl text-[var(--color-pib-accent)] leading-none">
                      {item.n}
                    </span>
                  </div>
                  <div className="md:col-span-10 max-w-3xl">
                    <h3 className="font-display text-3xl md:text-4xl leading-tight text-balance">
                      {item.title}
                    </h3>
                    <p className="mt-4 text-lg text-[var(--color-pib-text-muted)] leading-relaxed text-pretty">
                      {item.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* TECH WE TRUST */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
            <div className="lg:col-span-5">
              <Reveal>
                <p className="eyebrow mb-5">Tech we trust</p>
              </Reveal>
              <Reveal delay={80}>
                <h2 className="h-display text-balance">
                  Boring tools. Battle-tested.
                </h2>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 text-lg text-[var(--color-pib-text-muted)] leading-relaxed text-pretty max-w-md">
                  We pick stacks for what they look like in five years, not what&apos;s on Hacker
                  News this week. Then we go brave on the parts that actually move the needle.
                </p>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={120}>
                <div className="flex flex-wrap gap-2.5">
                  {TECH_STACK.map((tech) => (
                    <span key={tech} className="pill text-sm px-4 py-2">
                      {tech}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* BEHIND THE SCENES */}
      <section className="section border-t border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/30">
        <div className="container-pib">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="eyebrow mb-5">How we work</p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="h-display text-balance">
                Behind the scenes, every week.
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 text-lg text-[var(--color-pib-text-muted)] leading-relaxed text-pretty">
                No black box. You get a Linear board you can read, Vercel preview URLs for every
                pull request, a Loom video every week, and a WhatsApp channel for the things
                that don&apos;t need a meeting.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {BTS.map((tile, i) => (
              <Reveal key={tile.label} delay={i * 80}>
                <figure className="group">
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[16px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                    <Image
                      src={tile.src}
                      alt={tile.label}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4">
                      <p className="font-display text-xl text-white leading-tight">{tile.label}</p>
                    </div>
                  </div>
                  <figcaption className="mt-3 text-xs uppercase tracking-wider font-mono text-[var(--color-pib-text-muted)]">
                    {tile.caption}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WORKING TOGETHER */}
      <section className="section border-t border-[var(--color-pib-line)]">
        <div className="container-pib">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="eyebrow mb-5">Working together</p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="h-display text-balance">
                Three ways the relationship works.
              </h2>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {ENGAGEMENTS.map((mode, i) => (
              <Reveal key={mode.name} delay={i * 80}>
                <div className="bento-card h-full flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-display text-3xl">{mode.name}</h3>
                    <span className="pill pill-accent">{mode.badge}</span>
                  </div>
                  <p className="text-[var(--color-pib-text)] font-medium text-lg leading-snug mb-3">
                    {mode.blurb}
                  </p>
                  <p className="text-[var(--color-pib-text-muted)] leading-relaxed text-pretty">
                    {mode.body}
                  </p>
                  <div className="mt-8 pt-6 border-t border-[var(--color-pib-line)]">
                    <Link href="/start-a-project" className="pib-link-underline text-sm font-medium">
                      Start with {mode.name.toLowerCase()} →
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section border-t border-[var(--color-pib-line)] relative overflow-hidden">
        <div className="absolute inset-0 pib-mesh pointer-events-none" aria-hidden />
        <div className="container-pib relative text-center">
          <Reveal>
            <p className="eyebrow mb-6">Last thing</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="h-display text-balance max-w-4xl mx-auto">
              Want to build something together?
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 text-lg text-[var(--color-pib-text-muted)] max-w-xl mx-auto text-pretty">
              Send a one-paragraph brief. You&apos;ll hear back from me — not an inbox — within
              one business day.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap justify-center items-center gap-3">
              <Link href="/start-a-project" className="btn-pib-accent">
                Start a project
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
              <Link href={SITE.cal.url} className="btn-pib-secondary">
                Book a 20-min intro
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  )
}
