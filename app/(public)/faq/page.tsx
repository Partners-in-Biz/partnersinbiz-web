import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { Article, ArticleHead, ArticleRow, CtaSentence } from '@/components/marketing/paper/Article'
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

const ALL_SECTIONS = [
  { title: 'The basics', items: GENERAL_FAQ },
  { title: 'How we work', items: PROCESS_FAQ },
  { title: 'What we build with', items: TECH_FAQ },
  { title: 'What it costs', items: PRICING_FAQ },
]

const ALL_FAQ = [...GENERAL_FAQ, ...PROCESS_FAQ, ...TECH_FAQ, ...PRICING_FAQ]

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
      />

      {ALL_SECTIONS.map((section) => (
        <ArticleRow key={section.title} title={section.title}>
          <FAQ items={section.items} />
        </ArticleRow>
      ))}

      <ArticleRow>
        <CtaSentence lead="Tell us what you are building and we will tell you honestly if we are the right fit." />
      </ArticleRow>
    </Article>
  )
}
