import { SITE, SERVICES, CASE_STUDIES } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'

export const dynamic = 'force-static'
export const revalidate = 86400

export function GET() {
  const services = SERVICES.map(
    (s) => `- [${s.name}](${SITE.url}/services/${s.slug}): ${s.outcome}`
  ).join('\n')

  const cases = CASE_STUDIES.map(
    (c) => `- [${c.client}: ${c.headline}](${SITE.url}${c.href}): ${c.summary}`
  ).join('\n')

  const posts = POSTS.map(
    (p) => `- [${p.title}](${SITE.url}/insights/${p.slug}): ${p.description}`
  ).join('\n')

  const body = `# ${SITE.name}

> ${SITE.description}

Partners in Biz is a Pretoria software studio led by ${SITE.founder.name}. One person scopes the work, writes the code, sends the invoice and answers the WhatsApp. We build marketing sites that bring in clients, custom web applications, mobile apps for both stores, AI agents that do real work, and the growth systems that keep a site working after launch. Clients are in South Africa, the UK, the US, Australia and Europe.

Prices are on the site. A marketing site is from R35,000, fixed, half to start and half at launch, live in 2 to 4 weeks. A web application is from R120,000 after a two-week discovery; most land between R180,000 and R450,000. Retainers run from R15,000 a month and can be cancelled any month. We invoice in rand with USD and EUR available, take EFT for South African clients and PayPal for international ones.

Proof: AHS Law ranks first on Google for its main practice term and enquiries doubled; the site loads in 1.4 seconds on 4G. Loyalty Plus, a ten-year aviation loyalty platform, was rebuilt with zero downtime and page loads went from eight seconds to under two. Athleet, a sports club platform, went live for three pilot clubs in under four weeks. Velox and Lumen are in the App Store and on Google Play.

Clients own everything we build: the GitHub repository, the Vercel project, the database and the domain. We build with Next.js, React, Tailwind, TypeScript, Vercel, Firebase, Supabase, Claude and OpenAI.

## Services
${services}

## Case studies
${cases}

## Insights
${posts}

## Key pages
- [About](${SITE.url}/about): Founder note, the five things we do not compromise on, and how the relationship works
- [Process](${SITE.url}/our-process): How we work: Discover, Design, Build, Launch, Grow
- [Pricing](${SITE.url}/pricing): Real numbers in rand for sites, web apps, retainers and extras, with a comparison against the cheap template site
- [Services](${SITE.url}/services): Everything we do, with price and proof for each
- [US Offer, The 4-Week Site](${SITE.url}/us): Fixed $9,500 USD Next.js site in 28 days for US/Canada founders. Half to start, half at launch. Client owns the repo.
- [UK Offer, The 4-Week Site](${SITE.url}/uk): Fixed £7,500 GBP Next.js site in 28 days for UK founders. Half to start, half at launch. Client owns the repo.
- [AU Offer, The 4-Week Site](${SITE.url}/au): Fixed A$14,500 AUD Next.js site in 28 days for Australian founders. Half to start, half at launch. Client owns the repo.
- [EU Offer, The 4-Week Site](${SITE.url}/eu): Fixed €8,500 EUR Next.js site in 28 days for EU founders (English). Half to start, half at launch. Client owns the repo.
- [Gauteng Growth Audit](${SITE.url}/gauteng-growth-audit): Free website, local SEO, and social media audit for Gauteng SMEs
- [Book a 20-min call](${SITE.url}/book-a-call): the one scheduler for every project
- [Contact email](mailto:${SITE.email})

## Optional
- [Privacy policy](${SITE.url}/privacy-policy)
- [Terms of service](${SITE.url}/terms-of-service)
- [llms-full.txt](${SITE.url}/llms-full.txt): Complete site content concatenated for full-context AI ingestion
`

  return new Response(body, {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=86400, s-maxage=86400' },
  })
}
