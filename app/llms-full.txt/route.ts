import { SITE, SERVICES, CASE_STUDIES, PROCESS, FAQ_HOMEPAGE, TESTIMONIALS } from '@/lib/seo/site'
import { POSTS } from '@/lib/content/posts'

export const dynamic = 'force-static'
export const revalidate = 86400

export function GET() {
  const out: string[] = []

  out.push(`# ${SITE.name}  -  Full Site Content`)
  out.push(`Source: ${SITE.url}`)
  out.push(`Last generated: 2026-04-25`)
  out.push('')
  out.push('---')
  out.push('')

  // About
  out.push('## About Partners in Biz')
  out.push(SITE.description)
  out.push('')
  out.push(`Founded: ${SITE.founded}`)
  out.push(`Founder: ${SITE.founder.name} (${SITE.founder.role})`)
  out.push(`Location: ${SITE.address.addressLocality}, ${SITE.address.addressRegion}, ${SITE.address.addressCountry}`)
  out.push(`Contact: ${SITE.email}`)
  out.push('')

  // Services
  out.push('## Services')
  for (const s of SERVICES) {
    out.push(`### ${s.name}`)
    out.push(s.outcome)
    out.push(`Tech: ${s.keywords.join(', ')}`)
    out.push(`URL: ${SITE.url}/services/${s.slug}`)
    out.push('')
  }

  // Process
  out.push('## How we work')
  for (const p of PROCESS) {
    out.push(`### ${p.step}  -  ${p.name}`)
    out.push(p.blurb)
    out.push(`Deliverables: ${p.deliverables.join(', ')}`)
    out.push('')
  }

  // Case studies
  out.push('## Case studies')
  for (const c of CASE_STUDIES) {
    out.push(`### ${c.client}  -  ${c.headline}`)
    out.push(c.summary)
    out.push(`Industry: ${c.industry}`)
    out.push(`Year: ${c.year}`)
    out.push(`Stack: ${c.stack.join(', ')}`)
    out.push(`Metrics: ${c.metrics.map((m) => `${m.value} ${m.label}`).join(' · ')}`)
    out.push(`URL: ${SITE.url}${c.href}`)
    out.push('')
  }

  // Testimonials
  out.push('## What clients say')
  for (const t of TESTIMONIALS) {
    out.push(`> ${t.quote}`)
    out.push(` -  ${t.author}, ${t.role}`)
    out.push('')
  }

  // FAQ
  out.push('## Frequently asked questions')
  for (const f of FAQ_HOMEPAGE) {
    out.push(`### ${f.q}`)
    out.push(f.a)
    out.push('')
  }

  // Insights
  out.push('## Insights / Blog posts')
  for (const p of POSTS) {
    out.push(`### ${p.title}`)
    out.push(p.description)
    out.push(`Published: ${p.datePublished}`)
    out.push(`URL: ${SITE.url}/insights/${p.slug}`)
    out.push('')
  }

  return new Response(out.join('\n'), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=86400, s-maxage=86400' },
  })
}
