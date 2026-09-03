import type { Metadata } from 'next'
import { CASE_STUDIES, SITE, TESTIMONIALS } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { Article, ArticleHead, ArticleRow, CtaSentence, Plate, Quote } from '@/components/marketing/paper/Article'
import { WorkPinned } from '@/components/marketing/paper/WorkPinned'

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
        plate={
          <Plate
            src={WORK_SHOTS.ahsLaw.src}
            alt={WORK_SHOTS.ahsLaw.alt}
            caption="AHS Law. Number one on Google for its primary practice term in eight weeks."
            wide
            priority
          />
        }
      />

      <WorkPinned />

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
