'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CASE_STUDIES } from '@/lib/seo/site'
import { Reveal } from '@/components/marketing/Reveal'

type CaseStudy = (typeof CASE_STUDIES)[number]

const INDUSTRY_FILTERS = ['All', 'Sports', 'Aviation', 'Legal', 'EdTech'] as const
const SERVICE_FILTERS = ['All services', 'Web App', 'Mobile App', 'Marketing Website'] as const

type IndustryFilter = (typeof INDUSTRY_FILTERS)[number]
type ServiceFilter = (typeof SERVICE_FILTERS)[number]

function matchesIndustry(c: CaseStudy, f: IndustryFilter) {
  if (f === 'All') return true
  if (f === 'Sports') return c.industry.toLowerCase().includes('sport')
  if (f === 'Aviation') return c.industry.toLowerCase().includes('aviation')
  if (f === 'Legal') return c.industry.toLowerCase().includes('legal')
  if (f === 'EdTech') return c.industry.toLowerCase().includes('edtech') || c.industry.toLowerCase().includes('productivity')
  return true
}

function matchesService(c: CaseStudy, f: ServiceFilter) {
  if (f === 'All services') return true
  if (f === 'Web App') return c.services.some((s) => s.toLowerCase().includes('web application'))
  if (f === 'Mobile App') return c.services.some((s) => s.toLowerCase().includes('mobile'))
  if (f === 'Marketing Website') return c.services.some((s) => s.toLowerCase().includes('marketing'))
  return true
}

export function WorkGrid() {
  const [industry, setIndustry] = useState<IndustryFilter>('All')
  const [service, setService] = useState<ServiceFilter>('All services')

  const filtered = useMemo(
    () => CASE_STUDIES.filter((c) => matchesIndustry(c, industry) && matchesService(c, service)),
    [industry, service]
  )

  return (
    <>
      {/* Filters */}
      <div className="mb-12 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2">Industry</span>
          {INDUSTRY_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setIndustry(f)}
              className={`pill transition-colors ${
                industry === f ? 'pill-accent' : 'hover:border-[var(--color-pib-line-strong)] hover:text-[var(--color-pib-text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2">Service</span>
          {SERVICE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setService(f)}
              className={`pill transition-colors ${
                service === f ? 'pill-accent' : 'hover:border-[var(--color-pib-line-strong)] hover:text-[var(--color-pib-text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="bento-card text-center py-20">
          <p className="text-[var(--color-pib-text-muted)]">No case studies match those filters.</p>
          <button
            type="button"
            onClick={() => {
              setIndustry('All')
              setService('All services')
            }}
            className="btn-pib-secondary mt-6"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {filtered.map((c, i) => (
            <Reveal key={c.slug} delay={i * 80} as="article">
              <Link
                href={c.href}
                className="group bento-card flex h-full flex-col overflow-hidden p-0"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden">
                  <Image
                    src={c.cover}
                    alt={`${c.client} cover`}
                    fill
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover grayscale transition-all duration-700 group-hover:grayscale-0 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-pib-bg)]/80 via-transparent to-transparent" />
                  <div className="absolute left-5 top-5 flex items-center gap-2">
                    <span className="pill">{c.industry}</span>
                    <span className="pill">{c.year}</span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-5 p-6 md:p-8">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-pib-line-strong)] bg-[var(--color-pib-surface-2)] font-display text-base">
                      {c.client.charAt(0)}
                    </div>
                    <div className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                      {c.client}
                    </div>
                  </div>

                  <h3 className="font-display text-2xl md:text-3xl leading-[1.05] text-balance">
                    {c.headline}
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {c.metrics.map((m) => (
                      <span key={m.label} className="pill">
                        <strong className="text-[var(--color-pib-text)] font-semibold">{m.value}</strong>
                        <span className="text-[var(--color-pib-text-muted)]">{m.label}</span>
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-[var(--color-pib-line)]">
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                      {c.services.join(' · ')}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-pib-text)] transition-all group-hover:text-[var(--color-pib-accent)] group-hover:gap-3">
                      Read case
                      <span className="material-symbols-outlined text-base">arrow_forward</span>
                    </span>
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </>
  )
}
