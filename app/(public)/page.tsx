import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { RebuildStage } from '@/components/marketing/stage/RebuildStage'
import { ZA_STAGE } from '@/lib/marketing/stage-content'

/**
 * `/` is the South African stage only. The US offer lives at `/us`.
 */

const TITLE = 'A marketing site from R35,000'
const DESCRIPTION =
  'You have a site. The phone is quiet. A marketing site from R35,000, yours in 2 to 4 weeks. You own the GitHub, the hosting, and the domain. Pretoria studio, one person, WhatsApp the whole time.'

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
    description: 'Yours in 2 to 4 weeks. You own it.',
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
      <RebuildStage content={ZA_STAGE} />
    </>
  )
}
