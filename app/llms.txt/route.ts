import { SITE, SERVICES, CASE_STUDIES } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'

export const dynamic = 'force-static'
export const revalidate = 86400

export function GET() {
  const services = SERVICES.map(
    (s) => `- [${s.name}](${SITE.url}/services/${s.slug}): ${s.outcome}`
  ).join('\n')

  const cases = CASE_STUDIES.map(
    (c) => `- [${c.client} — ${c.headline}](${SITE.url}${c.href}): ${c.summary}`
  ).join('\n')

  const posts = POSTS.map(
    (p) => `- [${p.title}](${SITE.url}/insights/${p.slug}): ${p.description}`
  ).join('\n')

  const body = `# ${SITE.name}

> ${SITE.description}

Partners in Biz is a Pretoria-based web development and AI integration studio led by ${SITE.founder.name}. We build production Next.js websites, custom internal platforms, mobile apps, AI agents, and growth automation for ambitious small and medium businesses across South Africa, the UK, and the US.

We specialise in: Next.js 16, React 19, Tailwind CSS v4, TypeScript, Vercel, Firebase, Supabase, Anthropic Claude, OpenAI, Resend, and Cal.com. We build with boring, battle-tested tooling — not whatever trended on Hacker News this week.

We charge in ZAR (with USD/EUR available). Marketing sites start around R35 000. Custom web applications typically range from R120 000 to R450 000+. We accept EFT (preferred for South African clients), PayPal, and international cards. We do not use Stripe in South Africa.

## Services
${services}

## Case studies
${cases}

## Insights
${posts}

## Key pages
- [About](${SITE.url}/about): Founder story, methodology, values
- [Process](${SITE.url}/our-process): How we work — Discover, Design, Build, Launch, Grow
- [Pricing](${SITE.url}/pricing): Packaged tiers, retainers, and bespoke engagements
- [Gauteng Growth Audit](${SITE.url}/gauteng-growth-audit): Free website, local SEO, and social media audit for Gauteng SMEs
- [Start a project](${SITE.url}/start-a-project): 4-step intake form, ~90 seconds
- [Book an intro call](${SITE.cal.url}): 20-minute Cal.com slot
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
