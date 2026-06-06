import { SITE } from '@/lib/seo/site'

export type ToolSlug =
  | 'seo-roi-calculator'
  | 'website-cost-calculator'
  | 'lead-value-calculator'
  | 'meta-title-description-generator'
  | 'keyword-balance-checker'

export type PublicTool = {
  slug: ToolSlug
  title: string
  shortTitle: string
  description: string
  category: string
  icon: string
  outcome: string
  inputs: string[]
  cta: string
  serviceHref: string
  faqs: { q: string; a: string }[]
}

export const PUBLIC_TOOLS: PublicTool[] = [
  {
    slug: 'seo-roi-calculator',
    title: 'SEO ROI Calculator',
    shortTitle: 'SEO ROI',
    description: 'Estimate how organic traffic growth could turn into leads, customers, revenue, and monthly ROI.',
    category: 'SEO growth',
    icon: 'trending_up',
    outcome: 'Projected extra visits, leads, customers, revenue, ROI percentage, and payback multiple.',
    inputs: ['Current organic visits', 'Expected traffic lift', 'Lead conversion rate', 'Close rate', 'Average deal value', 'Monthly SEO investment'],
    cta: 'Turn this into a 30-day SEO growth plan',
    serviceHref: '/services/growth-systems',
    faqs: [
      {
        q: 'Is this a guarantee?',
        a: 'No. It is a planning estimate that helps you see whether SEO is commercially worth pursuing before you commit budget.',
      },
      {
        q: 'What should I do if the ROI is low?',
        a: 'Improve the conversion path first: clearer pages, stronger offers, better lead capture, and sales follow-up often matter more than raw traffic.',
      },
    ],
  },
  {
    slug: 'website-cost-calculator',
    title: 'Website Cost Calculator',
    shortTitle: 'Website Cost',
    description: 'Get a practical South African website budget range based on pages, design complexity, CMS needs, integrations, and portal/app scope.',
    category: 'Website planning',
    icon: 'request_quote',
    outcome: 'Estimated project range and a rough delivery timeline in weeks.',
    inputs: ['Page count', 'Design level', 'Copywriting', 'CMS', 'Integrations', 'Portal/app functionality'],
    cta: 'Ask PiB to scope the real build',
    serviceHref: '/services/web-development',
    faqs: [
      {
        q: 'Why is the output a range?',
        a: 'Real scope depends on content, design depth, integrations, approvals, and handover needs. A range is safer than a fake fixed quote.',
      },
      {
        q: 'Can PiB build only part of the project?',
        a: 'Yes. We can quote a focused website, a single app module, or a phased roadmap depending on what creates value first.',
      },
    ],
  },
  {
    slug: 'lead-value-calculator',
    title: 'Lead Value Calculator',
    shortTitle: 'Lead Value',
    description: 'Work out what a qualified lead is worth so you can judge SEO, content, ads, and CRM investment with less guesswork.',
    category: 'Revenue planning',
    icon: 'payments',
    outcome: 'Lead value, customer gross value, breakeven CPL, and a safer target CPL.',
    inputs: ['Average sale value', 'Gross margin', 'Close rate', 'Lifetime multiplier'],
    cta: 'Build a lead engine around this number',
    serviceHref: '/services/growth-systems',
    faqs: [
      {
        q: 'Why use margin instead of revenue?',
        a: 'Because paying for leads from gross revenue can hide unprofitable campaigns. Margin gives a more honest ceiling.',
      },
      {
        q: 'What is a lifetime multiplier?',
        a: 'Use 1 for once-off sales. Increase it when clients renew, buy retainers, or reliably purchase more than once.',
      },
    ],
  },
  {
    slug: 'meta-title-description-generator',
    title: 'Meta Title & Description Generator',
    shortTitle: 'Meta Generator',
    description: 'Create practical title tag and meta description options with length guidance for service pages, landing pages, and local SEO.',
    category: 'On-page SEO',
    icon: 'edit_note',
    outcome: 'Three title/description options with live character counts and rewrite direction.',
    inputs: ['Business name', 'Service', 'Location', 'Audience', 'Benefit'],
    cta: 'Let PiB review the whole page',
    serviceHref: '/services/web-development',
    faqs: [
      {
        q: 'Will better metadata make a page rank?',
        a: 'Metadata helps searchers understand the page, but rankings also depend on page quality, technical SEO, links, and search intent fit.',
      },
      {
        q: 'Should every page use the same format?',
        a: 'No. Keep important pages specific. Repeated titles and vague descriptions weaken click-through and make site structure less clear.',
      },
    ],
  },
  {
    slug: 'keyword-balance-checker',
    title: 'Keyword Balance Checker',
    shortTitle: 'Keyword Balance',
    description: 'Check whether a draft mentions a target phrase naturally without drifting into old-school keyword stuffing.',
    category: 'Content SEO',
    icon: 'manage_search',
    outcome: 'Word count, phrase mentions, density percentage, and practical guidance.',
    inputs: ['Draft text', 'Target phrase'],
    cta: 'Get a content improvement pass',
    serviceHref: '/services/growth-systems',
    faqs: [
      {
        q: 'Is keyword density still an SEO ranking formula?',
        a: 'No. Treat this as a repetition and coverage check, not a ranking score. Useful content, intent fit, entities, links, and proof matter more.',
      },
      {
        q: 'What density should I aim for?',
        a: 'There is no universal target. If the phrase feels forced, reduce it. If it never appears, add it where it helps readers understand the page.',
      },
    ],
  },
]

export const toolBySlug = new Map(PUBLIC_TOOLS.map(tool => [tool.slug, tool]))

export function getToolUrl(slug: ToolSlug) {
  return `${SITE.url}/tools/${slug}`
}

export function toolSoftwareSchema(tool: PublicTool) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.title,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: getToolUrl(tool.slug),
    description: tool.description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'ZAR',
    },
    provider: {
      '@type': 'Organization',
      name: SITE.name,
      url: SITE.url,
    },
  }
}

export function toolCollectionSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Free business growth and SEO tools from Partners in Biz',
    url: `${SITE.url}/tools`,
    description: 'Free calculators, generators, and SEO checkers for South African businesses planning growth work.',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: PUBLIC_TOOLS.map((tool, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: getToolUrl(tool.slug),
        name: tool.title,
      })),
    },
  }
}
