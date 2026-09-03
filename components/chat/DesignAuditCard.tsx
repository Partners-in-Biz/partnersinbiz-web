'use client'

/**
 * Design Audit action card - Messages rich part renderer (T2).
 *
 * Renders the `design_audit` rich part produced by
 * `lib/design-audit/audit-card.ts`: findings grouped P0-P3 with element
 * references, a live-page screenshot overlay when present, and severity
 * metrics. The action buttons (Fix it / Ignore + reason / Re-run / Open
 * design audit) render through the standard RichActionBar from the
 * message's uiActions, not inside this component.
 */

import type { RichMessagePart } from '@/lib/hermes/types'

export interface DesignAuditFindingView {
  rule: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  ref: string
  line?: number
  snippet?: string
  message?: string
  value?: string
}

function partString(part: RichMessagePart, key: string): string {
  const value = part[key]
  return typeof value === 'string' ? value : ''
}

function richRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanFinding(value: unknown): DesignAuditFindingView | null {
  const rec = richRecord(value)
  if (!rec) return null
  const rule = typeof rec.rule === 'string' ? rec.rule.trim() : ''
  const severity = rec.severity === 'P0' || rec.severity === 'P1' || rec.severity === 'P2' || rec.severity === 'P3'
    ? rec.severity
    : null
  const ref = typeof rec.ref === 'string' ? rec.ref.trim() : ''
  if (!rule || !severity || !ref) return null
  return {
    rule,
    severity,
    ref,
    ...(typeof rec.line === 'number' && Number.isFinite(rec.line) ? { line: rec.line } : {}),
    ...(typeof rec.snippet === 'string' && rec.snippet.trim() ? { snippet: rec.snippet.trim().slice(0, 200) } : {}),
    ...(typeof rec.message === 'string' && rec.message.trim() ? { message: rec.message.trim().slice(0, 300) } : {}),
    ...(typeof rec.value === 'string' && rec.value.trim() ? { value: rec.value.trim().slice(0, 80) } : {}),
  }
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

const SEVERITY_STYLE: Record<string, { badge: string; rail: string }> = {
  P0: { badge: 'border-red-400/40 bg-red-500/15 text-red-100', rail: 'bg-red-400' },
  P1: { badge: 'border-amber-400/40 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]', rail: 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]' },
  P2: { badge: 'border-sky-400/40 bg-sky-500/15 text-sky-100', rail: 'bg-sky-400' },
  P3: { badge: 'border-[var(--color-pib-line)] bg-[var(--color-row-hover)] text-[var(--color-pib-text-muted)]', rail: 'bg-[color-mix(in_srgb,var(--color-pib-text)_40%,transparent)]' },
}

export function DesignAuditCard({ part }: { part: RichMessagePart }) {
  const title = partString(part, 'title') || 'Design audit'
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
          alt: typeof rec.alt === 'string' ? rec.alt : 'Design audit page screenshot',
          caption: typeof rec.caption === 'string' ? rec.caption : '',
        }]
      }).slice(0, 1)
    : []
  const sections = sectionItems(part)

  const clean = !statusLabel.toLowerCase().includes('failed')
    && !statusLabel.toLowerCase().includes('finding')
    && statusLabel.toLowerCase() === 'clean'

  return (
    <article aria-label={title} data-testid="design-audit-card" className="my-2 max-w-full overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] shadow-sm shadow-black/10">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--color-pib-line)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.18em] text-primary">Design audit</p>
          <p className="mt-0.5 break-words text-sm font-medium leading-snug text-[var(--color-pib-text)] [overflow-wrap:anywhere]">{title}</p>
        </div>
        {statusLabel && (
          <span
            data-testid="design-audit-status"
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${ statusLabel.toLowerCase() === 'clean' ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' : statusLabel.toLowerCase().includes('failed') ? 'border-red-400/35 bg-red-500/10 text-red-200' : 'border-amber-400/35 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]' }`}
          >
            {statusLabel}
          </span>
        )}
      </header>

      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-[var(--color-pib-line)] px-3 py-2">
          {metrics.map((metric) => (
            <span key={metric.label} className="inline-flex min-w-14 items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1 text-[11px]">
              <span className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">{metric.label}</span>
              <span className="font-medium tabular-nums text-[var(--color-pib-text)]">{metric.value}</span>
            </span>
          ))}
        </div>
      )}

      {images.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element -- audit screenshot from workbench browser frame storage
        <a href={images[0].url} target="_blank" rel="noreferrer" className="block border-b border-[var(--color-pib-line)]" data-testid="design-audit-screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element -- audit screenshot from workbench browser frame storage */}
          <img src={images[0].url} alt={images[0].alt} className="max-h-64 w-full object-cover object-top" loading="lazy" />
          {images[0].caption && <span className="block px-3 py-1 text-[10px] text-[var(--color-pib-text-muted)]">{images[0].caption}</span>}
        </a>
      )}

      <div className="px-3 py-2.5">
        {body && <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{body}</p>}

        {clean && sections.length === 0 && (
          <p className="mt-2 rounded-md border border-emerald-400/20 bg-emerald-500/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-emerald-100">
            No failing findings - this page passes the deterministic design rules.
          </p>
        )}

        {sections.length > 0 && (
          <div className="mt-2 space-y-3">
            {sections.map((section) => {
              const severityMatch = section.heading.match(/^(P[0-3])/i)
              const style = severityMatch ? SEVERITY_STYLE[severityMatch[1].toUpperCase()] ?? SEVERITY_STYLE.P3 : SEVERITY_STYLE.P3
              return (
                <section key={section.heading} data-testid={`design-audit-section-${section.heading}`}>
                  <p className="flex items-center gap-2 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">
                    <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-[4px] ${style.rail}`} />
                    {section.heading}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {section.items.map((item, index) => (
                      <li key={`${item}-${index}`} className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--color-pib-text)]">
                        <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {evidence.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-[var(--color-pib-line)] pt-2">
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

/** Standalone helper so the card can be reused outside the bubble. */
export function designAuditFindingsFromPart(part: RichMessagePart): DesignAuditFindingView[] {
  const findings: DesignAuditFindingView[] = []
  for (const section of sectionItems(part)) {
    for (const item of section.items) {
      const rec = richRecord(item)
      const cleaned = cleanFinding(rec ?? item)
      if (cleaned) findings.push(cleaned)
    }
  }
  return findings
}
