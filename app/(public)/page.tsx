import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { RebuildStage } from '@/components/marketing/stage/RebuildStage'
import { ZA_STAGE } from '@/lib/marketing/stage-content'

/**
 * `/` is the South African stage only. The US offer lives at `/us`.
 */

const TITLE = 'A site that makes the phone ring'
const DESCRIPTION =
  'You have a site. The phone is quiet. We build marketing sites that bring in enquiries, in 2 to 4 weeks, from R35,000 fixed. You own the GitHub, the hosting, and the domain. Pretoria studio, one person, WhatsApp the whole time.'

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
    description: 'Built in 2 to 4 weeks. Yours outright. From R35,000.',
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
