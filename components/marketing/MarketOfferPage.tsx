import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema } from '@/lib/seo/schema'
import { STAGE_STILLS } from '@/lib/marketing/stage-content'
import { type MarketOffer, marketBookHref, marketOfferUrl } from '@/lib/seo/market-offers'
import { Article, ArticleHead, ArticleList, ArticleRow, CtaSentence, Plate, Proof } from '@/components/marketing/paper/Article'

const INCLUDED_BASE = [
  'A custom Next.js site, not a template',
  'Loads in under two seconds. Built to rank.',
  'Real lead capture, wired to your inbox or CRM',
  'Analytics live on day one',
  'Your repo, your hosting, your keys',
] as const

const EXCLUDED = ['Discovery theatre', 'Account managers', 'Monthly platform fees', 'A site you do not own'] as const

const PROOF = [
  { line: 'Club platform live in under four weeks. 500 plus athletes on it.', credit: 'Athleet', href: '/work/athleet' },
  { line: 'First on Google for their main practice term. Enquiries doubled.', credit: 'AHS Law', href: '/work/ahs-law' },
  { line: 'In the App Store and on Google Play.', credit: 'Velox', href: '/work/velox' },
] as const

export function MarketOfferPage({ market }: { market: MarketOffer }) {
  const bookHref = marketBookHref(market.id)
  const included = [...INCLUDED_BASE, `One person. WhatsApp the whole time. ${market.overlapLabel}`]

  const offerSchema = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: 'The 4-Week Site',
    description: 'Production Next.js marketing site shipped in 28 days. Client owns GitHub, Vercel, and domain.',
    price: market.priceAmount,
    priceCurrency: market.currencyCode,
    availability: 'https://schema.org/InStock',
    url: marketOfferUrl(market.id),
    seller: { '@type': 'Organization', name: SITE.name, url: SITE.url },
  }

  return (
    <Article>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Home', url: '/' },
          { name: `${market.regionLabel} Offer`, url: market.path },
        ])}
      />
      <JsonLd data={offerSchema} />

      <ArticleHead
        kicker={`Partners in Biz. ${market.regionLabel}.`}
        title="A site that gets you clients. Yours in 28 days."
        lede={
          <>
            <strong>{market.priceDisplay}.</strong> Half to start, half at launch. Most agencies take a quarter and hand you
            a theme. We ship production Next.js in four weeks and you own the GitHub, the Vercel and the domain. Fire us
            the next day and nothing breaks.
          </>
        }
      >
        <Plate src={STAGE_STILLS.storefrontAfter.src} alt={STAGE_STILLS.storefrontAfter.alt} priority />
        <CtaSentence lead="Twenty minutes is enough to know if this is the right shape." href={bookHref} />
      </ArticleHead>

      <ArticleRow
        title="What is in, and what is not"
        aside={
          <>
            <p className="sc-tiny">Not included, on purpose</p>
            <ArticleList items={EXCLUDED} />
          </>
        }
      >
        <ArticleList items={included} />
      </ArticleRow>

      <ArticleRow
        title="Proof"
        flip
        aside={
          <>
            <p className="sc-tiny">Who this is for</p>
            <p className="sc-body">{market.whoFor}</p>
            <p className="sc-tiny">Who it is not for</p>
            <p className="sc-body">Anyone who wants a {market.cheapAltDisplay}. Anyone who needs a nine-month committee.</p>
          </>
        }
      >
        {PROOF.map((p) => (
          <Proof key={p.credit} line={p.line} credit={p.credit} href={p.href} />
        ))}
      </ArticleRow>

      <ArticleRow
        title="The 90-Day Fill"
        aside={
          <>
            <p className="sc-article__price">{market.fillPriceDisplay}</p>
            <p className="sc-body">90 days. Half now, half at day 45. Add it when you book the site, or the week you launch.</p>
          </>
        }
      >
        <p>
          You have a site. Google still sends people to the firm that has been there for ten years. For 90 days we make your
          Google Business Profile do the selling: the map pack, the reviews, the posts that mention the neighbourhoods you
          serve, the services section that matches what people type at 11pm.
        </p>
        <p>
          Week one we fix the listing so you show up for the searches that pay. Week two we load it with the words Google
          needs. Week three we set up the review loop so every happy client becomes a ranking signal. Week four we start
          posting like a business that is alive. Then we run it for two more months.
        </p>
        <p>
          You do not log into anything. You do not write posts. You take the calls. The 4-Week Site gives them a place they
          can trust. The 90-Day Fill gets them to find it.
        </p>
      </ArticleRow>

      <ArticleRow title="After the 90 days" flip>
        <p>
          Want us to keep shipping? <strong>{market.retainerDisplay}.</strong> Cancel any month. Need a portal or an app?{' '}
          <strong>{market.portalFromDisplay}.</strong> See{' '}
          <Link href="/services" prefetch={false} className="sc-link">
            everything we do
          </Link>
          .
        </p>
        <CtaSentence lead="One price. One promise. 28 days." href={bookHref} />
      </ArticleRow>
    </Article>
  )
}
