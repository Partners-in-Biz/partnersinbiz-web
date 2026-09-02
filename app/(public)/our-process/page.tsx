import type { Metadata } from 'next'
import { SITE, PROCESS } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { Article, ArticleHead, ArticleList, ArticleRow, CtaSentence, Plate } from '@/components/marketing/paper/Article'
import { FAQ } from '@/components/marketing/FAQ'

const DESCRIPTION =
  'How we ship: a brief, a design, a build you can open every day, a launch, and the months after. Real timelines for sites, apps, mobile and AI work.'

export const metadata: Metadata = {
  title: 'How we work',
  description: DESCRIPTION,
  alternates: { canonical: '/our-process' },
  openGraph: {
    title: `How we work | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/our-process`,
    type: 'article',
  },
}

const TIMELINES = [
  { type: 'Marketing site', range: '2 to 4 weeks', notes: 'Copy readiness, page count, and whether you need a CMS.' },
  { type: 'Web app, first version', range: '6 to 12 weeks', notes: 'Auth, data model, integrations, and admin tooling.' },
  { type: 'Mobile app, version one', range: '8 to 16 weeks', notes: 'Native modules and the store review cycle.' },
  { type: 'AI integration', range: '2 to 6 weeks', notes: 'A feature inside an existing product, or a new agent with tools and memory.' },
] as const

const WEEKLY = [
  'A preview link you can open any time. Every pull request gets its own.',
  'A board you can read. Every ticket, status and blocker is visible.',
  'A short video walkthrough at the end of the week: what shipped, what is next.',
  'A WhatsApp channel for the things that do not need a meeting. Replies the same business day.',
] as const

const PROCESS_FAQ = [
  {
    q: 'What if I want to change scope mid-build?',
    a: 'Most projects do. Small changes, under about four hours, we absorb. Anything bigger gets a one-line change order with a price and a timeline impact, sent on WhatsApp before we touch it.',
  },
  {
    q: 'Do I need to know exactly what I want?',
    a: 'No. If you arrive with a brief, good. If you arrive with a problem, we shape the brief together on the first call and in the discovery weeks.',
  },
  {
    q: 'Can I bring my own designer?',
    a: 'Yes. We set up the Figma to GitHub handover so it is clean. If you do not have one, we have a small bench we trust.',
  },
  {
    q: 'What does a typical week look like?',
    a: 'A short check-in on Monday. Deep work and pull requests midweek. A video update on Friday with what shipped and any decisions we need from you. Anything urgent goes on WhatsApp.',
  },
  {
    q: 'What happens if you get hit by a bus?',
    a: 'Everything is in your GitHub, your Vercel and your database from day one, and documented in your repo. We use mainstream tooling so any competent engineer can pick it up, and we keep a written handover for exactly that case.',
  },
  {
    q: 'How do payments work?',
    a: 'EFT first. A marketing site is half to start, half at launch. Larger builds run 40, 30, 30 across start, design sign-off and launch. Retainers are billed monthly in advance.',
  },
]

export default function OurProcessPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Process', url: '/our-process' },
  ])

  return (
    <Article>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqSchema(PROCESS_FAQ)} />

      <ArticleHead
        kicker="How we work"
        title="We do not sell hours. We ship software."
        lede="Five steps, real artifacts, no theatre. This is how every engagement runs, from the first call to the months after launch."
        plate={<Plate src={WORK_SHOTS.velox.src} alt={WORK_SHOTS.velox.alt} caption="Velox. Shipped to both stores from one codebase." wide priority />}
      />

      {PROCESS.map((phase, i) => (
        <ArticleRow
          key={phase.step}
          title={`${phase.step}. ${phase.name}`}
          flip={i % 2 === 1}
          aside={
            <>
              <p className="sc-tiny">What you get</p>
              <ArticleList items={phase.deliverables} />
            </>
          }
        >
          <p>{phase.blurb}</p>
        </ArticleRow>
      ))}

      <ArticleRow
        title="How long it takes"
        aside={
          <>
            <p className="sc-tiny">Every week, without asking</p>
            <ArticleList items={WEEKLY} />
          </>
        }
      >
        <p>Real ranges, not sales-call optimism. The number depends on a few variables we settle on the first call.</p>
        <table className="sc-article__table">
          <thead>
            <tr>
              <th scope="col">Engagement</th>
              <th scope="col">Range</th>
              <th scope="col">What moves it</th>
            </tr>
          </thead>
          <tbody>
            {TIMELINES.map((row) => (
              <tr key={row.type}>
                <th scope="row">{row.type}</th>
                <td>{row.range}</td>
                <td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ArticleRow>

      <ArticleRow title="Things people ask">
        <FAQ items={PROCESS_FAQ} />
        <CtaSentence lead="One call, then a fixed-scope quote within three working days." />
      </ArticleRow>
    </Article>
  )
}
