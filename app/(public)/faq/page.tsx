import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE, TECH_STACK } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import {
  Article,
  ArticleHead,
  ArticleList,
  ArticleRow,
  CtaSentence,
  Plate,
  Proof,
} from '@/components/marketing/paper/Article'
import { FAQ } from '@/components/marketing/FAQ'

const DESCRIPTION =
  'Straight answers about working with Partners in Biz: what we build, how long it takes, what it costs, what we build with, and what happens after launch.'

export const metadata: Metadata = {
  title: 'FAQ',
  description: DESCRIPTION,
  alternates: { canonical: '/faq' },
  openGraph: {
    title: `FAQ | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/faq`,
    type: 'website',
  },
}

const GENERAL_FAQ = [
  {
    q: 'Who is Partners in Biz for?',
    a: 'Founders, operators and marketing leads at South African businesses who want software that brings in clients, built by the person who quoted it. We keep client numbers low so quality stays high.',
  },
  {
    q: 'What do you build?',
    a: 'Marketing sites that make the phone ring, custom web applications, mobile apps, AI agents that do real work, client portals, and growth systems. We also run SEO sprints and social media for clients who want the ongoing work handled.',
  },
  {
    q: 'Where are you based?',
    a: 'Pretoria. We work with clients across South Africa and abroad, mostly on WhatsApp and preview links, so you do not need to be in the same city or time zone.',
  },
  {
    q: 'How is this different from an agency?',
    a: 'One person scopes the work, writes the code, sends the invoice and answers the WhatsApp. No junior developer behind an account manager. You own everything we build the day it ships.',
  },
]

const PROCESS_FAQ = [
  {
    q: 'How does a project start?',
    a: 'Book a 20-minute call. We talk through what you have and what you need, and you get a fixed-scope quote within three working days. No discovery retainers, no surprise NDAs.',
  },
  {
    q: 'How long does a project take?',
    a: 'A marketing site is live in 2 to 4 weeks. A web application takes 6 to 12 weeks for a working first version, with a usable preview from week two. You get a milestone timeline at kick-off.',
  },
  {
    q: 'Do you work on existing codebases?',
    a: 'Yes. Audits, migrations and feature work. The first step is a code review so we can scope the work honestly.',
  },
  {
    q: 'What does the week look like while you build?',
    a: 'A preview link you can open any time, a WhatsApp channel for the things that do not need a meeting, and decisions written down. You never wait a week to hear what is happening.',
  },
  {
    q: 'Do you do design as well as development?',
    a: 'Yes. We design in Figma before writing code. For marketing sites we work from your brand. For web apps we run a design sprint and get sign-off before the build.',
  },
]

const TECH_FAQ = [
  {
    q: 'What do you build with?',
    a: 'Next.js on Vercel, Firebase or Supabase for data and auth, Tailwind and TypeScript throughout, Claude and OpenAI for AI features. Boring, supported tools, chosen for what they look like in five years.',
  },
  {
    q: 'Do you build mobile apps?',
    a: 'Yes. iOS and Android from one codebase, with offline support, push notifications and store submission for both platforms. See the mobile apps service page for what ships and what it costs.',
  },
  {
    q: 'Who hosts the site after launch?',
    a: 'Vercel for the application, Firebase or Supabase for the database, all on your accounts. Most marketing sites cost under R500 a month to run. We set it up and hand over access cleanly.',
  },
  {
    q: 'Do you handle SEO?',
    a: 'Every marketing site ships with the technical work done: schema, sitemap, llms.txt, and metadata. For ongoing ranking work, our 90-day sprint targets specific terms and tracks positions monthly.',
  },
]

const PRICING_FAQ = [
  {
    q: 'What does it cost?',
    a: 'A marketing site from R35,000. A web application from R120,000. Retainers from R15,000 a month. Fixed-scope extras such as an SEO sprint, a performance audit, an AI feature or a brand identity are priced on the pricing page.',
  },
  {
    q: 'How do payment terms work?',
    a: 'For a marketing site, half to start and half at launch. For larger builds, 40% to start, 30% at design sign-off, 30% at launch. EFT for South African clients with no fees; PayPal for international clients at 3.5%.',
  },
  {
    q: 'Do you offer retainers?',
    a: 'Yes. Lite is R15,000 a month for eight hours. Growth is R35,000 for twenty hours with roadmap reviews. Embedded is R75,000 for forty hours with on-call. All month to month with 30 days notice.',
  },
  {
    q: 'Can we do equity or revenue share?',
    a: 'For bespoke builds, sometimes. Roughly one in five of those projects. The bar is real founders, real traction, and a problem we want to solve. Equity sits on top of a discounted cash rate.',
  },
]

const ALL_FAQ = [...GENERAL_FAQ, ...PROCESS_FAQ, ...TECH_FAQ, ...PRICING_FAQ]

const WEEKLY = [
  'A preview link for every pull request.',
  'A board you can read, with every ticket and blocker.',
  'A short video of what shipped and what is next.',
  'A WhatsApp channel for the things that do not need a meeting.',
] as const

export default function FaqPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'FAQ', url: '/faq' },
  ])

  return (
    <Article>
      <JsonLd data={breadcrumb} />
      <JsonLd data={faqSchema(ALL_FAQ)} />

      <ArticleHead
        kicker="FAQ"
        title="Questions we get asked a lot."
        lede={
          <>
            Straight answers. If yours is not here, write to{' '}
            <a href={`mailto:${SITE.email}`} className="sc-link">
              {SITE.email}
            </a>{' '}
            and you will hear back from a person.
          </>
        }
        plate={
          <Plate
            src={WORK_SHOTS.ahsLaw.src}
            alt={WORK_SHOTS.ahsLaw.alt}
            caption="AHS Law. Number one on Google in eight weeks."
            wide
            priority
          />
        }
      />

      <ArticleRow
        title="The basics"
        aside={
          <Proof
            line="One person scopes the work, writes the code, sends the invoice and answers the WhatsApp. You own everything the day it ships."
            credit="How the studio works"
            href="/about"
          />
        }
      >
        <FAQ items={GENERAL_FAQ} />
      </ArticleRow>

      <ArticleRow
        title="How we work"
        flip
        aside={
          <>
            <p className="sc-tiny">Every week, without asking</p>
            <ArticleList items={WEEKLY} />
          </>
        }
      >
        <FAQ items={PROCESS_FAQ} />
      </ArticleRow>

      <ArticleRow
        title="What we build with"
        aside={
          <>
            <p className="sc-tiny">Tools we trust</p>
            <p className="sc-body">
              {TECH_STACK.join(', ')}. Picked for what they look like in five years, not for what is on Hacker News this week.
            </p>
            <p className="sc-body">
              <Link href="/services" prefetch={false} className="sc-link">
                Everything we do
              </Link>
            </p>
          </>
        }
      >
        <FAQ items={TECH_FAQ} />
      </ArticleRow>

      <ArticleRow
        title="What it costs"
        flip
        aside={
          <>
            <p className="sc-article__price">From R35,000</p>
            <p className="sc-body">
              A marketing site, fixed scope and fixed price, live in 2 to 4 weeks. Every number is on the{' '}
              <Link href="/pricing" prefetch={false} className="sc-link">
                pricing page
              </Link>
              .
            </p>
          </>
        }
      >
        <FAQ items={PRICING_FAQ} />
      </ArticleRow>

      <ArticleRow
        title="Still not sure?"
        aside={
          <Proof
            line="AHS Law. Number one on Google in eight weeks. Athleet. Club platform live for three clubs in under four weeks."
            credit="See the work"
            href="/work"
          />
        }
      >
        <p>
          Twenty minutes is enough to know if this is the right shape for you. No discovery retainer, no deck, no
          follow-up sequence. If we are not the right fit, we will say so and point you to someone who is.
        </p>
        <CtaSentence lead="Tell us what you are building and we will tell you honestly if we are the right fit." />
      </ArticleRow>
    </Article>
  )
}
