import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE, FAQ_HOMEPAGE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, serviceSchema } from '@/lib/seo/schema'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { SERVICE_CONTENT, SERVICE_ORDER, serviceMeta } from '@/lib/marketing/service-content'
import { Article, ArticleHead, ArticleRow, CtaSentence, Plate } from '@/components/marketing/paper/Article'
import { ServicesFilmstrip } from '@/components/marketing/paper/ServicesFilmstrip'
import { FAQ } from '@/components/marketing/FAQ'

const TITLE = 'Everything we do'
const DESCRIPTION =
  'Marketing sites from R35,000 that make the phone ring. Web apps from R120,000. Mobile, AI agents, growth systems and bespoke builds. One Pretoria studio, real prices, and you own the code.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/services' },
  openGraph: {
    title: `${TITLE} | ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/services`,
    type: 'website',
  },
}

export default function ServicesIndexPage() {
  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Services', url: '/services' },
  ])

  return (
    <Article>
      <JsonLd data={breadcrumb} />
      {SERVICE_ORDER.map((slug) => {
        const meta = serviceMeta(slug)
        const content = SERVICE_CONTENT[slug]
        return (
          <JsonLd
            key={slug}
            data={serviceSchema({ slug, name: meta.name, description: content.headline, priceFrom: content.price.amount })}
          />
        )
      })}

      <ArticleHead
        kicker="Services"
        title={TITLE}
        lede="Most people arrive for the site. Some need the software behind it. This is the whole firm on one page, with the price next to each thing, so you can decide before the call."
        plate={<Plate src={WORK_SHOTS.athleet.src} alt={WORK_SHOTS.athleet.alt} caption="Athleet. Club platform, live in under four weeks." wide priority />}
      />

      <ServicesFilmstrip />

      <ArticleRow
        title="Three shapes of engagement"
        aside={
          <p className="sc-body">
            Sites we build ship with{' '}
            <Link href="/properties" prefetch={false} className="sc-link">
              Partners in Biz Properties
            </Link>
            , our runtime control plane: feature flags, a kill switch, and per-site analytics you can change without a redeploy.
          </p>
        }
      >
        <p>
          <strong>Project.</strong> Fixed scope, fixed price. Quoted in three business days, delivered against a board you can read, code in your GitHub at the end.
        </p>
        <p>
          <strong>Retainer.</strong> A standing block of senior engineering time each month, from R15,000. Hosting, monitoring, security patches, and the work that never fits a project shape.
        </p>
        <p>
          <strong>Advisory.</strong> A senior outside view for founders and CTOs: architecture review, AI strategy, hiring decisions. Monthly sessions and async review of pull requests and specs.
        </p>
        <CtaSentence lead="Twenty minutes is enough to tell you which shape fits and what it costs." />
      </ArticleRow>

      <ArticleRow title="The questions everyone asks">
        <FAQ items={FAQ_HOMEPAGE} />
      </ArticleRow>
    </Article>
  )
}
