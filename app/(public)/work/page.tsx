import type { Metadata } from 'next'
import Link from 'next/link'
import { CASE_STUDIES, SITE, TESTIMONIALS } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { Article, ArticleHead, ArticleList, ArticleRow, CtaSentence, Plate, Quote } from '@/components/marketing/paper/Article'

const TITLE = 'Work'
const DESCRIPTION =
  'Real builds with real names: a law firm site that ranks first, a ten-year loyalty platform rebuilt with zero downtime, a sports club platform live in under four weeks, and apps in both stores.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/work' },
  openGraph: {
    title: `${TITLE} | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/work`,
    type: 'website',
  },
}

export default function WorkIndexPage() {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: CASE_STUDIES.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE.url}${c.href}`,
      name: c.headline,
    })),
  }

  return (
    <Article>
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Work', url: '/work' }])} />
      <JsonLd data={itemList} />

      <ArticleHead
        kicker="Work"
        title="Real builds. Real names."
        lede="Every project here is a live codebase we can point at. Law firms, sports clubs, an aviation loyalty platform, and two apps in both stores."
      />

      {CASE_STUDIES.map((c, i) => (
        <ArticleRow
          key={c.slug}
          title={c.headline}
          flip={i % 2 === 1}
          aside={
            <>
              <Plate src={c.cover} alt={`${c.client}: ${c.headline}`} priority={i === 0} />
              <ArticleList items={c.metrics.map((m) => `${m.value} ${m.label}`)} />
            </>
          }
        >
          <p className="sc-tiny">
            {c.client}. {c.industry}. {c.year}.
          </p>
          <p>{c.summary}</p>
          <p>
            <Link href={c.href} prefetch={false} className="sc-cta">
              Read the case
            </Link>
          </p>
        </ArticleRow>
      ))}

      <ArticleRow
        title="What clients say"
        aside={<Quote quote={TESTIMONIALS[2].quote} by={TESTIMONIALS[2].role} />}
      >
        <Quote quote={TESTIMONIALS[0].quote} by={TESTIMONIALS[0].role} />
        <CtaSentence lead="We take on a small number of new builds each quarter." />
      </ArticleRow>
    </Article>
  )
}
