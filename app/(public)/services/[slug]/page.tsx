import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SERVICES, SITE } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'
import { JsonLd, breadcrumbSchema, serviceSchema, faqSchema } from '@/lib/seo/schema'
import { STAGE_STILLS, WORK_SHOTS } from '@/lib/marketing/stage-content'
import { SERVICE_CONTENT, SERVICE_ORDER, caseFor, type ServiceSlug } from '@/lib/marketing/service-content'
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

const PLATES: Record<ServiceSlug, { src: string; alt: string }> = {
  'web-development': WORK_SHOTS.ahsLaw,
  'web-applications': WORK_SHOTS.athleet,
  'mobile-apps': WORK_SHOTS.velox,
  'ai-integration': WORK_SHOTS.lumen,
  'growth-systems': WORK_SHOTS.scrolledBrain,
  'bespoke-builds': STAGE_STILLS.rebuildScrub,
}

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const service = SERVICES.find((s) => s.slug === slug)
  if (!service) return { title: 'Service not found' }
  const content = SERVICE_CONTENT[service.slug]
  const description = `${content.headline} ${content.price.label}. ${content.price.terms}`
  return {
    title: `${service.name}: ${content.headline}`,
    description,
    alternates: { canonical: `/services/${service.slug}` },
    openGraph: {
      title: `${service.name} | ${SITE.name}`,
      description,
      url: `${SITE.url}/services/${service.slug}`,
      type: 'website',
    },
  }
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const service = SERVICES.find((s) => s.slug === slug)
  if (!service) notFound()

  const content = SERVICE_CONTENT[service.slug]
  const study = caseFor(content.proof.caseSlug)
  const plate = content.plate ?? PLATES[service.slug]
  const related = content.relatedInsightSlugs
    .map((s) => POSTS.find((p) => p.slug === s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const others = SERVICE_ORDER.filter((s) => s !== service.slug)

  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Services', url: '/services' },
    { name: service.name, url: `/services/${service.slug}` },
  ])

  return (
    <Article>
      <JsonLd data={breadcrumb} />
      <JsonLd
        data={serviceSchema({
          slug: service.slug,
          name: service.name,
          description: content.headline,
          priceFrom: content.price.amount,
        })}
      />
      <JsonLd data={faqSchema(content.faqs)} />

      <ArticleHead
        kicker={
          <>
            <Link href="/services" prefetch={false} className="sc-link">
              Services
            </Link>
            {' / '}
            {service.name}
          </>
        }
        title={content.headline}
        lede={content.lede}
      >
        <Plate src={plate.src} alt={plate.alt} priority />
      </ArticleHead>

      <ArticleRow
        title={content.price.label}
        aside={
          <>
            <p className="sc-tiny">What the price buys</p>
            <ArticleList items={content.price.includes} />
          </>
        }
      >
        <p>{content.price.terms}</p>
        {content.price.contrast && <p>{content.price.contrast}</p>}
        <CtaSentence lead="Twenty minutes is enough to know if this is the right shape for you." />
      </ArticleRow>

      <ArticleRow
        title="Who this is for"
        flip
        aside={<Proof line={content.proof.line} credit={`${study.client}, ${study.industry}`} href={study.href} />}
      >
        {content.who.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ArticleRow>

      <ArticleRow
        title="What ships"
        aside={
          <>
            <p className="sc-tiny">How it runs</p>
            <ol className="sc-article__list">
              {content.steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}.</strong> {step.body}
                </li>
              ))}
            </ol>
          </>
        }
      >
        <ArticleList items={content.deliverables} />
        <p>
          Built with {[...service.keywords].join(', ')}. Boring, supported tools, so the work is still standing in five years.
        </p>
      </ArticleRow>

      <ArticleRow title={`Questions about ${service.name.toLowerCase()}`}>
        <FAQ items={content.faqs} />
      </ArticleRow>

      <ArticleRow
        title="Also on the call if you need it"
        flip
        aside={
          related.length > 0 ? (
            <>
              <p className="sc-tiny">Further reading</p>
              <ul className="sc-article__list">
                {related.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/insights/${p.slug}`} prefetch={false} className="sc-link">
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : undefined
        }
      >
        <p>
          {others.map((s, i) => (
            <span key={s}>
              <Link href={`/services/${s}`} prefetch={false} className="sc-link">
                {SERVICES.find((meta) => meta.slug === s)?.name}
              </Link>
              {i < others.length - 1 ? ', ' : '.'}
            </span>
          ))}{' '}
          <Link href="/services" prefetch={false} className="sc-link">
            Everything we do
          </Link>
          .
        </p>
        <CtaSentence lead={`Ready to talk about ${service.name.toLowerCase()}?`} />
      </ArticleRow>
    </Article>
  )
}
