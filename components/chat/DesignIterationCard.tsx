'use client'

/**
 * Design Iteration ("Design this page") - Messages rich part renderer (P1).
 *
 * Renders the `design_iteration` rich part produced by
 * `lib/design-iteration/iteration-card.ts`: the baseline screenshot, the
 * user instruction + element refs, and the variant deck (one entry per
 * archetype-distinct variant with status). The Accept/Reject action buttons
 * render through the standard RichActionBar from the message's uiActions,
 * not inside this component.
 */

import type { RichMessagePart } from '@/lib/hermes/types'

function partString(part: RichMessagePart, key: string): string {
  const value = part[key]
  return typeof value === 'string' ? value : ''
}

function richRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sectionItems(part: RichMessagePart): Array<{ heading: string; items: string[] }> {
  if (!Array.isArray(part.sections)) return []
  return part.sections.flatMap((section) => {
    const rec = richRecord(section)
    if (!rec) return []
    const heading = typeof rec.heading === 'string' && rec.heading.trim()
      ? rec.heading.trim()
      : typeof rec.title === 'string' && rec.title.trim()
        ? rec.title.trim()
        : ''
    const rawItems = Array.isArray(rec.items) ? rec.items : []
    const items = rawItems
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter((item) => item.length > 0)
      .slice(0, 50)
    return heading || items.length ? [{ heading, items }] : []
  })
}

const VARIANT_STYLE: Record<string, { badge: string; rail: string }> = {
  accepted: { badge: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100', rail: 'bg-emerald-400' },
  rejected: { badge: 'border-red-400/40 bg-red-500/15 text-red-100', rail: 'bg-red-400' },
  pending: { badge: 'border-sky-400/40 bg-sky-500/15 text-sky-100', rail: 'bg-sky-400' },
}

export function DesignIterationCard({ part }: { part: RichMessagePart }) {
  const title = partString(part, 'title') || 'Design this page'
  const statusLabel = partString(part, 'statusLabel') || partString(part, 'status') || ''
  const body = partString(part, 'body') || partString(part, 'content') || ''
  const evidence = Array.isArray(part.evidence)
    ? part.evidence.map((item) => typeof item === 'string' ? item : '').filter(Boolean)
    : []
  const metrics = Array.isArray(part.metrics)
    ? part.metrics.flatMap((metric) => {
        const rec = richRecord(metric)
        if (!rec) return []
        const label = typeof rec.label === 'string' ? rec.label : ''
        const value = typeof rec.value === 'number' || typeof rec.value === 'string' ? String(rec.value) : ''
        return label && value !== '' ? [{ label, value }] : []
      }).slice(0, 6)
    : []
  const images = Array.isArray(part.images)
    ? part.images.flatMap((image) => {
        const rec = richRecord(image)
        if (!rec) return []
        const url = typeof rec.url === 'string' ? rec.url : ''
        if (!url) return []
        return [{
          url,
          alt: typeof rec.alt === 'string' ? rec.alt : 'Design this page baseline',
          caption: typeof rec.caption === 'string' ? rec.caption : '',
        }]
      }).slice(0, 1)
    : []
  const sections = sectionItems(part)

  const applied = statusLabel.toLowerCase() === 'applied'

  return (
    <article aria-label={title} data-testid="design-iteration-card" className="my-2 max-w-full overflow-hidden rounded-lg border border-white/15 bg-white/[0.03] shadow-sm shadow-black/10">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.18em] text-primary">Design this page</p>
          <p className="mt-0.5 break-words text-sm font-medium leading-snug text-[var(--color-pib-text)] [overflow-wrap:anywhere]">{title}</p>
        </div>
        {statusLabel && (
          <span
            data-testid="design-iteration-status"
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${ applied ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' : statusLabel.toLowerCase().includes('rejected') ? 'border-red-400/35 bg-red-500/10 text-red-200' : statusLabel.toLowerCase().includes('accepted') ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/35 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]' }`}
          >
            {statusLabel}
          </span>
        )}
      </header>

      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 py-2">
          {metrics.map((metric) => (
            <span key={metric.label} className="inline-flex min-w-14 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px]">
              <span className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">{metric.label}</span>
              <span className="font-medium tabular-nums text-[var(--color-pib-text)]">{metric.value}</span>
            </span>
          ))}
        </div>
      )}

      {images.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element -- baseline screenshot from workbench browser frame storage
        <a href={images[0].url} target="_blank" rel="noreferrer" className="block border-b border-white/10" data-testid="design-iteration-screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element -- baseline screenshot from workbench browser frame storage */}
          <img src={images[0].url} alt={images[0].alt} className="max-h-64 w-full object-cover object-top" loading="lazy" />
          {images[0].caption && <span className="block px-3 py-1 text-[10px] text-[var(--color-pib-text-muted)]">{images[0].caption}</span>}
        </a>
      )}

      <div className="px-3 py-2.5">
        {body && <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{body}</p>}

        {sections.length > 0 && (
          <div className="mt-2 space-y-3">
            {sections.map((section) => {
              const statusMatch = section.heading.match(/\[(accepted|rejected|pending)\]/i)
              const style = statusMatch ? VARIANT_STYLE[statusMatch[1].toLowerCase()] ?? VARIANT_STYLE.pending : VARIANT_STYLE.pending
              return (
                <section key={section.heading} data-testid={`design-iteration-variant-${section.heading}`}>
                  <p className="flex items-center gap-2 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
                    <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-[4px] ${style.rail}`} />
                    {section.heading}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {section.items.map((item, index) => (
                      <li key={`${item}-${index}`} className="rounded-md border border-white/[0.07] bg-black/15 px-2 py-1.5 text-[11px] leading-relaxed text-[var(--color-pib-text)]">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {evidence.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-white/[0.07] pt-2">
            {evidence.map((item, index) => (
              <li key={`${item}-${index}`} className="flex min-w-0 gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
                <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-[4px] bg-primary/70" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
