export type SeoRoiInput = {
  monthlyOrganicVisits: number
  expectedTrafficLiftPct: number
  visitorToLeadRatePct: number
  leadCloseRatePct: number
  averageDealValue: number
  monthlySeoInvestment: number
}

export type SeoRoiResult = {
  additionalVisits: number
  additionalLeads: number
  projectedCustomers: number
  projectedRevenue: number
  roiPct: number
  paybackMultiple: number
}

const round = (value: number, decimals = 0) => {
  const factor = 10 ** decimals
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
}

const pct = (value: number) => value / 100

export function calculateSeoRoi(input: SeoRoiInput): SeoRoiResult {
  const additionalVisits = input.monthlyOrganicVisits * pct(input.expectedTrafficLiftPct)
  const additionalLeads = additionalVisits * pct(input.visitorToLeadRatePct)
  const projectedCustomers = additionalLeads * pct(input.leadCloseRatePct)
  const projectedRevenue = projectedCustomers * input.averageDealValue
  const roiPct = input.monthlySeoInvestment > 0
    ? ((projectedRevenue - input.monthlySeoInvestment) / input.monthlySeoInvestment) * 100
    : 0
  const paybackMultiple = input.monthlySeoInvestment > 0
    ? projectedRevenue / input.monthlySeoInvestment
    : 0

  return {
    additionalVisits: round(additionalVisits),
    additionalLeads: round(additionalLeads, 1),
    projectedCustomers: round(projectedCustomers, 1),
    projectedRevenue: round(projectedRevenue),
    roiPct: round(roiPct),
    paybackMultiple: round(paybackMultiple, 1),
  }
}

export type WebsiteCostInput = {
  pageCount: number
  designLevel: 'lean' | 'polished' | 'premium'
  needsCopywriting: boolean
  needsCms: boolean
  integrationCount: number
  hasPortalOrApp: boolean
}

export type WebsiteCostResult = {
  low: number
  high: number
  timelineWeeks: number
}

export function estimateWebsiteCost(input: WebsiteCostInput): WebsiteCostResult {
  const designMultiplier = input.designLevel === 'premium' ? 1.6 : input.designLevel === 'polished' ? 1.25 : 1
  const base = 18000
  const pages = input.pageCount * 2800
  const copy = input.needsCopywriting ? input.pageCount * 1200 : 0
  const cms = input.needsCms ? 14000 : 0
  const integrations = input.integrationCount * 6500
  const portal = input.hasPortalOrApp ? 45000 : 0
  const low = (base + pages + copy + cms + integrations + portal) * designMultiplier
  const high = low * (input.hasPortalOrApp ? 1.55 : 1.35)
  const timelineWeeks = Math.max(2, Math.ceil((input.pageCount / 5) + input.integrationCount + (input.hasPortalOrApp ? 4 : 0)))

  return {
    low: round(low),
    high: round(high),
    timelineWeeks,
  }
}

export type LeadValueInput = {
  averageSaleValue: number
  grossMarginPct: number
  closeRatePct: number
  lifetimeMultiplier: number
}

export type LeadValueResult = {
  leadValue: number
  customerGrossValue: number
  maxCostPerLeadAtBreakeven: number
  suggestedCostPerLead: number
}

export function calculateLeadValue(input: LeadValueInput): LeadValueResult {
  const customerGrossValue = input.averageSaleValue * pct(input.grossMarginPct) * input.lifetimeMultiplier
  const leadValue = customerGrossValue * pct(input.closeRatePct)

  return {
    leadValue: round(leadValue),
    customerGrossValue: round(customerGrossValue),
    maxCostPerLeadAtBreakeven: round(leadValue),
    suggestedCostPerLead: round(leadValue * 0.55),
  }
}

export type MetaGeneratorInput = {
  businessName: string
  service: string
  location: string
  audience: string
  benefit: string
}

export type MetaSuggestion = {
  title: string
  description: string
}

const clean = (value: string, fallback: string) => value.trim() || fallback

export function generateMetaSuggestions(input: MetaGeneratorInput): MetaSuggestion[] {
  const businessName = clean(input.businessName, 'Your business')
  const service = clean(input.service, 'Growth service')
  const location = clean(input.location, 'South Africa')
  const audience = clean(input.audience, 'businesses')
  const benefit = clean(input.benefit, 'get measurable growth')

  return [
    {
      title: `${service} in ${location} | ${businessName}`,
      description: `${businessName} helps ${audience} ${benefit}. Explore practical ${service.toLowerCase()} support built for measurable outcomes.`,
    },
    {
      title: `${businessName} — ${service} for ${audience}`,
      description: `Need ${service.toLowerCase()} in ${location}? ${businessName} builds clear, practical growth systems so ${audience} can ${benefit}.`,
    },
    {
      title: `${service} that helps ${audience} ${benefit}`,
      description: `Work with ${businessName} for ${service.toLowerCase()} in ${location}: focused strategy, implementation, and proof-led improvements.`,
    },
  ]
}

export type KeywordBalanceInput = {
  text: string
  keyword: string
}

export type KeywordBalanceResult = {
  wordCount: number
  keywordMentions: number
  densityPct: number
  guidance: string
}

export function calculateKeywordBalance(input: KeywordBalanceInput): KeywordBalanceResult {
  const words = input.text.toLowerCase().match(/[a-z0-9]+/gi) ?? []
  const keyword = input.keyword.trim().toLowerCase()
  const haystack = input.text.toLowerCase()
  const keywordMentions = keyword
    ? (haystack.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    : 0
  const densityPct = words.length ? (keywordMentions / words.length) * 100 : 0
  let guidance = 'Add more useful context before worrying about repetition.'
  if (words.length >= 80 && keywordMentions === 0) guidance = 'The phrase is missing. Add it naturally where it matches search intent.'
  if (densityPct > 3) guidance = 'This looks repetitive. Rewrite for topic coverage, not keyword stuffing.'
  if (densityPct > 0 && densityPct <= 3) guidance = 'The phrase is present. Now improve examples, entities, internal links, and answers.'

  return {
    wordCount: words.length,
    keywordMentions,
    densityPct: round(densityPct, 2),
    guidance,
  }
}
