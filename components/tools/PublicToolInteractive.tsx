'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { ToolSlug } from '@/lib/tools/catalog'
import {
  calculateKeywordBalance,
  calculateLeadValue,
  calculateSeoRoi,
  estimateWebsiteCost,
  generateMetaSuggestions,
} from '@/lib/tools/calculators'

const formatZar = (value: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value)

const NumberField = ({
  label,
  value,
  onChange,
  suffix,
  min = 0,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  min?: number
}) => (
  <label className="block">
    <span className="text-sm font-medium text-[var(--color-pib-text)]">{label}</span>
    <div className="mt-2 flex items-center rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-4 py-3 focus-within:border-[var(--color-pib-accent)]">
      <input
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-transparent text-[var(--color-pib-text)] outline-none"
      />
      {suffix ? <span className="ml-2 text-sm text-[var(--color-pib-text-muted)]">{suffix}</span> : null}
    </div>
  </label>
)

const TextField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <label className="block">
    <span className="text-sm font-medium text-[var(--color-pib-text)]">{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-4 py-3 text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
    />
  </label>
)

const ResultCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/55 p-5">
    <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">{label}</p>
    <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{value}</p>
    {hint ? <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{hint}</p> : null}
  </div>
)

function SeoRoiTool() {
  const [input, setInput] = useState({
    monthlyOrganicVisits: 2500,
    expectedTrafficLiftPct: 30,
    visitorToLeadRatePct: 2.5,
    leadCloseRatePct: 20,
    averageDealValue: 35000,
    monthlySeoInvestment: 18000,
  })
  const result = useMemo(() => calculateSeoRoi(input), [input])
  const set = (key: keyof typeof input) => (value: number) => setInput(current => ({ ...current, [key]: value }))

  return (
    <ToolPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <NumberField label="Monthly organic visits" value={input.monthlyOrganicVisits} onChange={set('monthlyOrganicVisits')} />
        <NumberField label="Expected traffic lift" value={input.expectedTrafficLiftPct} onChange={set('expectedTrafficLiftPct')} suffix="%" />
        <NumberField label="Visitor to lead rate" value={input.visitorToLeadRatePct} onChange={set('visitorToLeadRatePct')} suffix="%" />
        <NumberField label="Lead close rate" value={input.leadCloseRatePct} onChange={set('leadCloseRatePct')} suffix="%" />
        <NumberField label="Average deal value" value={input.averageDealValue} onChange={set('averageDealValue')} />
        <NumberField label="Monthly SEO investment" value={input.monthlySeoInvestment} onChange={set('monthlySeoInvestment')} />
      </div>
      <ResultGrid>
        <ResultCard label="Extra visits" value={result.additionalVisits.toLocaleString('en-ZA')} />
        <ResultCard label="Extra leads" value={result.additionalLeads.toLocaleString('en-ZA')} />
        <ResultCard label="Projected revenue" value={formatZar(result.projectedRevenue)} />
        <ResultCard label="Monthly ROI" value={`${result.roiPct}%`} hint={`${result.paybackMultiple}x payback estimate`} />
      </ResultGrid>
    </ToolPanel>
  )
}

function WebsiteCostTool() {
  const [input, setInput] = useState({
    pageCount: 8,
    designLevel: 'polished' as const,
    needsCopywriting: true,
    needsCms: true,
    integrationCount: 2,
    hasPortalOrApp: false,
  })
  const result = useMemo(() => estimateWebsiteCost(input), [input])

  return (
    <ToolPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <NumberField label="Number of pages" value={input.pageCount} onChange={value => setInput(current => ({ ...current, pageCount: value }))} min={1} />
        <label className="block">
          <span className="text-sm font-medium text-[var(--color-pib-text)]">Design level</span>
          <select
            value={input.designLevel}
            onChange={(event) => setInput(current => ({ ...current, designLevel: event.target.value as typeof input.designLevel }))}
            className="mt-2 w-full rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-4 py-3 text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
          >
            <option value="lean">Lean and fast</option>
            <option value="polished">Polished brand site</option>
            <option value="premium">Premium custom design</option>
          </select>
        </label>
        <NumberField label="Integrations" value={input.integrationCount} onChange={value => setInput(current => ({ ...current, integrationCount: value }))} />
        <Toggle label="Copywriting included" checked={input.needsCopywriting} onChange={value => setInput(current => ({ ...current, needsCopywriting: value }))} />
        <Toggle label="CMS / editable content" checked={input.needsCms} onChange={value => setInput(current => ({ ...current, needsCms: value }))} />
        <Toggle label="Portal or app functionality" checked={input.hasPortalOrApp} onChange={value => setInput(current => ({ ...current, hasPortalOrApp: value }))} />
      </div>
      <ResultGrid>
        <ResultCard label="Estimated low" value={formatZar(result.low)} />
        <ResultCard label="Estimated high" value={formatZar(result.high)} />
        <ResultCard label="Rough timeline" value={`${result.timelineWeeks} weeks`} hint="Depends on feedback speed and content readiness." />
      </ResultGrid>
    </ToolPanel>
  )
}

function LeadValueTool() {
  const [input, setInput] = useState({
    averageSaleValue: 45000,
    grossMarginPct: 55,
    closeRatePct: 18,
    lifetimeMultiplier: 1.5,
  })
  const result = useMemo(() => calculateLeadValue(input), [input])
  const set = (key: keyof typeof input) => (value: number) => setInput(current => ({ ...current, [key]: value }))

  return (
    <ToolPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <NumberField label="Average sale value" value={input.averageSaleValue} onChange={set('averageSaleValue')} />
        <NumberField label="Gross margin" value={input.grossMarginPct} onChange={set('grossMarginPct')} suffix="%" />
        <NumberField label="Close rate" value={input.closeRatePct} onChange={set('closeRatePct')} suffix="%" />
        <NumberField label="Lifetime multiplier" value={input.lifetimeMultiplier} onChange={set('lifetimeMultiplier')} min={1} />
      </div>
      <ResultGrid>
        <ResultCard label="Lead value" value={formatZar(result.leadValue)} />
        <ResultCard label="Customer gross value" value={formatZar(result.customerGrossValue)} />
        <ResultCard label="Breakeven CPL" value={formatZar(result.maxCostPerLeadAtBreakeven)} />
        <ResultCard label="Safer target CPL" value={formatZar(result.suggestedCostPerLead)} />
      </ResultGrid>
    </ToolPanel>
  )
}

function MetaGeneratorTool() {
  const [input, setInput] = useState({
    businessName: 'Partners in Biz',
    service: 'SEO sprint',
    location: 'South Africa',
    audience: 'ambitious SMEs',
    benefit: 'turn organic traffic into qualified leads',
  })
  const suggestions = useMemo(() => generateMetaSuggestions(input), [input])
  const set = (key: keyof typeof input) => (value: string) => setInput(current => ({ ...current, [key]: value }))

  return (
    <ToolPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Business name" value={input.businessName} onChange={set('businessName')} />
        <TextField label="Service or page topic" value={input.service} onChange={set('service')} />
        <TextField label="Location" value={input.location} onChange={set('location')} />
        <TextField label="Audience" value={input.audience} onChange={set('audience')} />
        <div className="md:col-span-2">
          <TextField label="Main benefit" value={input.benefit} onChange={set('benefit')} />
        </div>
      </div>
      <div className="mt-8 space-y-4">
        {suggestions.map((suggestion, index) => (
          <div key={suggestion.title} className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/55 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-pib-text-faint)]">Option {index + 1}</p>
            <p className="mt-3 font-display text-xl text-[var(--color-pib-text)]">{suggestion.title}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-faint)]">{suggestion.title.length} characters</p>
            <p className="mt-4 text-[var(--color-pib-text-muted)]">{suggestion.description}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-faint)]">{suggestion.description.length} characters</p>
          </div>
        ))}
      </div>
    </ToolPanel>
  )
}

function KeywordBalanceTool() {
  const [text, setText] = useState('Paste a page draft or paragraph here. Good SEO copy should answer the searcher, mention the topic naturally, and avoid repeating the same phrase just to chase a density score.')
  const [keyword, setKeyword] = useState('SEO copy')
  const result = useMemo(() => calculateKeywordBalance({ text, keyword }), [text, keyword])

  return (
    <ToolPanel>
      <TextField label="Target phrase" value={keyword} onChange={setKeyword} />
      <label className="mt-4 block">
        <span className="text-sm font-medium text-[var(--color-pib-text)]">Draft text</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          className="mt-2 w-full rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-4 py-3 text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
        />
      </label>
      <ResultGrid>
        <ResultCard label="Word count" value={result.wordCount.toLocaleString('en-ZA')} />
        <ResultCard label="Phrase mentions" value={result.keywordMentions.toString()} />
        <ResultCard label="Density" value={`${result.densityPct}%`} />
        <ResultCard label="Guidance" value={result.guidance} />
      </ResultGrid>
    </ToolPanel>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/70 px-4 py-3">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="text-sm font-medium text-[var(--color-pib-text)]">{label}</span>
    </label>
  )
}

function ToolPanel({ children }: { children: ReactNode }) {
  return <div className="bento-card p-6 md:p-8">{children}</div>
}

function ResultGrid({ children }: { children: ReactNode }) {
  return <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{children}</div>
}

export function PublicToolInteractive({ slug }: { slug: ToolSlug }) {
  if (slug === 'seo-roi-calculator') return <SeoRoiTool />
  if (slug === 'website-cost-calculator') return <WebsiteCostTool />
  if (slug === 'lead-value-calculator') return <LeadValueTool />
  if (slug === 'meta-title-description-generator') return <MetaGeneratorTool />
  if (slug === 'keyword-balance-checker') return <KeywordBalanceTool />
  return null
}
