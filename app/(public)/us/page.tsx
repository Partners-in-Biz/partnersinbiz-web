import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { RebuildStage } from '@/components/marketing/stage/RebuildStage'
import { US_STAGE } from '@/lib/marketing/stage-content'

/**
 * `/us` is the United States stage only. The 4-Week Site ($9,500) and
 * The 90-Day Fill ($4,500). The ZA offer lives at `/`.
 */

const TITLE = 'The 4-Week Site. $9,500. Yours in 28 days.'
const DESCRIPTION =
  'You have a site. The phone is quiet. The 4-Week Site is $9,500: half on Stripe to start, half at launch, live in 28 days. The 90-Day Fill is $4,500: for 90 days we make your Google Business Profile do the selling. You own the repo, the hosting and the keys.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/us' },
  openGraph: {
    title: `${TITLE} | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/us`,
    type: 'website',
    images: ['/og/default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: 'The 4-Week Site gets you a place they can trust. The 90-Day Fill gets them to find it.',
  },
}

const seller = { '@type': 'Organization', name: SITE.name, url: SITE.url }

const offersSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Offer',
      name: 'The 4-Week Site',
      description:
        'A custom marketing site live in 28 days. Half on Stripe to start, half at launch. The client owns the repository, the hosting and the domain.',
      price: '9500',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE.url}/us`,
      seller,
      areaServed: 'US',
    },
    {
      '@type': 'Offer',
      name: 'The 90-Day Fill',
      description:
        'Ninety days of Google Business Profile work so the new site gets found. Half now, half on day 45.',
      price: '4500',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE.url}/us`,
      seller,
      areaServed: 'US',
    },
  ],
}

export default function UsHomePage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'United States', url: '/us' }])} />
      <JsonLd data={offersSchema} />
      <RebuildStage content={US_STAGE} />
    </>
  )
}
