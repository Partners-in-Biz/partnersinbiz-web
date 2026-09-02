import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { SITE, TECH_STACK } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Article, ArticleHead, ArticleList, ArticleRow, CtaSentence, Quote } from '@/components/marketing/paper/Article'

const DESCRIPTION =
  'Partners in Biz is a Pretoria studio led by Peet Stander. One person scopes the work, writes the code, sends the invoice and answers the WhatsApp. Sites, web apps, mobile and AI that you own outright.'

export const metadata: Metadata = {
  title: 'About',
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    title: `About | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/about`,
    type: 'profile',
    images: ['/images/peet-stander.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: `About | ${SITE.name}`,
    description: 'A founder-led software studio in Pretoria.',
  },
}

const MANIFESTO = [
  {
    title: 'Real code, not stubs.',
    body: 'No "we will fix it in version two". Every commit is production grade from day one. If a feature is in the scope, it works in the scope: typed, tested, and live on a preview before you see it.',
  },
  {
    title: 'Yours, not ours.',
    body: 'Your GitHub, your Vercel, your Firebase, your domains. We do not rent you back your own product. The day after launch you can fire us and nothing breaks.',
  },
  {
    title: 'EFT first.',
    body: 'South African banking works. We invoice in rand, take EFT by default, and only reach for PayPal or cards when the client is offshore. No 3% card tax on local invoices.',
  },
  {
    title: 'Boring tooling, brave decisions.',
    body: 'Next.js, Tailwind, Postgres, Firebase. Tools that will still be supported in five years. Then we go big on the parts that matter: AI integrations, novel UX, real product strategy.',
  },
  {
    title: 'The same person from quote to launch.',
    body: 'No handover from a sales lead to a junior developer. The person who scopes the work writes the code, sends the invoice and answers the WhatsApp.',
  },
] as const

const ENGAGEMENTS = [
  'Project. Fixed scope, fixed price, fixed launch date. Half on signature, half at launch. A marketing site from R35,000; most engagements run 2 to 12 weeks.',
  'Retainer. For teams who already shipped and need someone to keep shipping. Hosting, monitoring and 8 to 40 hours of development a month, from R15,000. Cancel any month.',
  'Advisory. For when you have a team and need a senior brain. Architecture review, AI feature design, hiring loops, vendor selection. From R950 an hour.',
] as const

export default function AboutPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'About', url: '/about' },
  ])

  return (
    <Article>
      <JsonLd data={breadcrumbs} />

      <ArticleHead
        kicker={`About. Pretoria, since ${SITE.founded}.`}
        title="Software the way it should be built. Boring, on time, and yours."
        lede="Partners in Biz is a Pretoria studio led by Peet Stander. We make websites, web apps, mobile apps and AI integrations that ship and keep working."
      />

      <ArticleRow
        title="I started this so I could send the invoice and answer the WhatsApp."
        aside={
          <>
            <div className="sc-photo sc-article__photo" style={{ aspectRatio: '4 / 5' }}>
              <Image
                src="/images/peet-stander.jpg"
                alt="Peet Stander, founder of Partners in Biz"
                fill
                sizes="(max-width: 900px) 90vw, 26rem"
                priority
              />
            </div>
            <p className="sc-tiny">
              {SITE.founder.name}. {SITE.founder.role}.
            </p>
          </>
        }
      >
        <p>
          Most agency engagements I had seen were too expensive, too slow, or too far from the business outcome. Three-month
          discovery phases. Junior developers at a senior price. Status decks instead of working software.
        </p>
        <Quote
          quote="The promise is simple. I write the code, I send the invoice, I answer the WhatsApp. The same person, from the first call to the launch announcement."
          by="Peet Stander"
        />
        <p>
          The wedge is deliberate: based in South Africa, working at a global standard, invoicing EFT first because local
          banking works fine. No card tax on local clients, no vendor lock-in, no handover from sales to a stranger.
        </p>
        <p>
          The work I take on is the work I can stand behind. If a project is not the right fit for budget, timeline or
          outcome, I will tell you on the first call and recommend someone better. The goal is not to win the brief. The
          goal is to ship something that earns its keep.
        </p>
      </ArticleRow>

      <ArticleRow
        title="Five things we will not compromise on"
        flip
        aside={
          <>
            <p className="sc-tiny">Tools we trust</p>
            <p className="sc-body">
              {TECH_STACK.join(', ')}. Picked for what they look like in five years, not for what is on Hacker News this week.
            </p>
          </>
        }
      >
        {MANIFESTO.map((item, i) => (
          <p key={item.title}>
            <strong>
              {String(i + 1).padStart(2, '0')}. {item.title}
            </strong>{' '}
            {item.body}
          </p>
        ))}
      </ArticleRow>

      <ArticleRow
        title="Three ways the relationship works"
        aside={
          <>
            <p className="sc-tiny">Every week, without asking</p>
            <ArticleList
              items={[
                'A board you can read, with every ticket and blocker.',
                'A preview link for every pull request.',
                'A short video of what shipped and what is next.',
                'A WhatsApp channel for the things that do not need a meeting.',
              ]}
            />
          </>
        }
      >
        <ArticleList items={ENGAGEMENTS} />
        <p>
          Prices and what each one buys are on the{' '}
          <Link href="/pricing" prefetch={false} className="sc-link">
            pricing page
          </Link>
          . The whole firm is on{' '}
          <Link href="/services" prefetch={false} className="sc-link">
            Everything we do
          </Link>
          .
        </p>
        <CtaSentence lead="Send a one-paragraph brief and you will hear back from me, not an inbox, within one business day." />
      </ArticleRow>
    </Article>
  )
}
