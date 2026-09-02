import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { StudioStage } from '@/components/marketing/stage/StudioStage'
import { ZA_STUDIO } from '@/lib/marketing/studio-content'

/**
 * `/` is the South African stage only. The US offer lives at `/us`.
 */

const TITLE = 'Software that brings in clients'
const DESCRIPTION =
  'Websites, web apps, mobile apps and AI for South African businesses. A site that makes the phone ring from R35,000 in 2 to 4 weeks; web apps from R120,000. Built in Pretoria by the person who quotes it, and yours outright.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: `${TITLE} | ${SITE.name}`,
    description: DESCRIPTION,
    url: '/',
    type: 'website',
    images: ['/og/default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: 'Software that brings in clients. Sites from R35,000, web apps from R120,000, yours outright.',
  },
}

const offerSchema = {
  '@context': 'https://schema.org',
  '@type': 'Offer',
  name: 'Marketing site',
  description: 'A marketing site built in 2 to 4 weeks. The client owns the GitHub repository, the hosting and the domain.',
  price: '35000',
  priceCurrency: 'ZAR',
  priceSpecification: {
    '@type': 'PriceSpecification',
    price: '35000',
    priceCurrency: 'ZAR',
    minPrice: '35000',
  },
  availability: 'https://schema.org/InStock',
  url: SITE.url,
  seller: { '@type': 'Organization', name: SITE.name, url: SITE.url },
  areaServed: 'ZA',
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }])} />
      <JsonLd data={offerSchema} />
      <StudioStage content={ZA_STUDIO} />
    </>
  )
}
