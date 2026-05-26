import type { ReactNode } from 'react'
import type {
  BeforeAfterBlockContent,
  CaseStudyResultCardsBlockContent,
  DocumentBlock,
  FunnelBlockContent,
  LogoTestimonialProofBlockContent,
  QuadrantMatrixBlockContent,
  RadarBlockContent,
  RoadmapGanttBlockContent,
  WeightedDecisionMatrixBlockContent,
} from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type ShowcaseShellProps = {
  block: DocumentBlock
  index: number
  eyebrow?: string
  headline?: string
  description?: string
  children: ReactNode
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  complete: 'Complete',
  at_risk: 'At risk',
  blocked: 'Blocked',
}

function clamp(value: unknown, min = 0, max = 100) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.max(min, Math.min(max, n))
}

function toPercent(value: unknown, max: unknown = 100) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const m = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100
  return clamp((n / m) * 100)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' })
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
}

function ShowcaseShell({ block, index, eyebrow, headline, description, children }: ShowcaseShellProps) {
  const title = headline || block.title
  return (
    <BlockFrame block={block} index={index}>
      <div className="pib-card overflow-hidden !p-0" data-showcase-block={block.type}>
        <div className="border-b border-[var(--color-card-border)] bg-[var(--color-card)]/80 px-5 py-5 sm:px-6">
          {eyebrow && <p className="text-xs font-label uppercase tracking-[0.2em] text-[var(--doc-accent)]">{eyebrow}</p>}
          {title && <h2 className="mt-2 text-2xl font-semibold text-[var(--doc-text)] md:text-4xl">{title}</h2>}
          {description && <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--doc-muted)]">{description}</p>}
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </BlockFrame>
  )
}

function EmptyShowcaseState({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-[var(--color-card-border)] p-5 text-sm text-[var(--doc-muted)]">No {label} supplied yet.</p>
}

export function FunnelBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as FunnelBlockContent
  const stages = Array.isArray(content?.stages) ? content.stages : []
  const max = Math.max(...stages.map((stage) => (typeof stage.value === 'number' ? stage.value : 0)), 1)

  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      {stages.length === 0 ? <EmptyShowcaseState label="funnel stages" /> : (
        <ol aria-label={content?.headline || block.title || 'Funnel stages'} className="grid gap-3 md:grid-cols-2">
          {stages.map((stage, i) => {
            const width = toPercent(stage.value, max)
            return (
              <li key={stage.id || `${stage.label}-${i}`} className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 transition-colors motion-safe:duration-200 hover:border-[var(--doc-accent)]/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--doc-muted)]">Stage {i + 1}</p>
                    <h3 className="mt-1 text-lg font-semibold text-[var(--doc-text)]">{stage.label}</h3>
                  </div>
                  {typeof stage.value === 'number' && <span className="rounded-full bg-[var(--doc-accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--doc-accent)]">{stage.value}</span>}
                </div>
                {stage.description && <p className="mt-3 text-sm leading-6 text-[var(--doc-muted)]">{stage.description}</p>}
                <div className="mt-4 h-2 rounded-full bg-[var(--doc-border)]" aria-hidden="true">
                  <div className="h-full rounded-full bg-[var(--doc-accent)] motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${width}%` }} />
                </div>
                {typeof stage.conversionRate === 'number' && <p className="mt-2 text-xs text-[var(--doc-muted)]">Conversion: {stage.conversionRate}%</p>}
              </li>
            )
          })}
        </ol>
      )}
    </ShowcaseShell>
  )
}

export function RadarBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as RadarBlockContent
  const axes = Array.isArray(content?.axes) ? content.axes : []
  const points = axes.map((axis, i) => {
    const angle = (-90 + (360 / Math.max(axes.length, 1)) * i) * (Math.PI / 180)
    const radius = 42 * (toPercent(axis.value, axis.max) / 100)
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, axis, angle }
  })
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      {axes.length === 0 ? <EmptyShowcaseState label="radar axes" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(240px,360px)_1fr] lg:items-center">
          <svg role="img" aria-label={content?.headline || block.title || 'Radar chart'} viewBox="0 0 100 100" className="mx-auto aspect-square w-full max-w-sm overflow-visible">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--doc-border)" strokeWidth="0.8" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="var(--doc-border)" strokeWidth="0.6" />
            <circle cx="50" cy="50" r="14" fill="none" stroke="var(--doc-border)" strokeWidth="0.6" />
            {points.map((point) => (
              <line key={point.axis.id} x1="50" y1="50" x2={50 + Math.cos(point.angle) * 42} y2={50 + Math.sin(point.angle) * 42} stroke="var(--doc-border)" strokeWidth="0.6" />
            ))}
            <polygon points={polygon} fill="var(--doc-accent-soft)" stroke="var(--doc-accent)" strokeWidth="1.8" />
            {points.map((point) => <circle key={point.axis.id} cx={point.x} cy={point.y} r="2" fill="var(--doc-accent)" />)}
          </svg>
          <ul className="grid gap-3 sm:grid-cols-2">
            {axes.map((axis) => (
              <li key={axis.id} className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[var(--doc-text)]">{axis.label}</span>
                  <span className="text-sm text-[var(--doc-muted)]">{axis.value}/{axis.max ?? 100}</span>
                </div>
                {typeof axis.benchmark === 'number' && <p className="mt-2 text-xs text-[var(--doc-muted)]">Benchmark: {axis.benchmark}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ShowcaseShell>
  )
}

export function QuadrantMatrixBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as QuadrantMatrixBlockContent
  const items = Array.isArray(content?.items) ? content.items : []
  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      <div role="img" aria-label={content?.headline || block.title || 'Quadrant matrix'} className="relative min-h-[320px] rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5">
        <div className="absolute inset-5 border-l border-b border-[var(--doc-border)]" aria-hidden="true" />
        <div className="absolute left-1/2 top-5 bottom-5 w-px bg-[var(--doc-border)]" aria-hidden="true" />
        <div className="absolute left-5 right-5 top-1/2 h-px bg-[var(--doc-border)]" aria-hidden="true" />
        <p className="absolute bottom-2 left-5 text-xs text-[var(--doc-muted)]">{content?.xAxis?.minLabel || 'Low'} {content?.xAxis?.label}</p>
        <p className="absolute bottom-2 right-5 text-xs text-[var(--doc-muted)]">{content?.xAxis?.maxLabel || 'High'} {content?.xAxis?.label}</p>
        <p className="absolute left-2 top-5 text-xs text-[var(--doc-muted)] [writing-mode:vertical-rl]">{content?.yAxis?.maxLabel || 'High'} {content?.yAxis?.label}</p>
        {items.map((item) => (
          <div key={item.id} className="absolute max-w-[11rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--doc-accent)]/40 bg-[var(--doc-accent-soft)] px-3 py-2 text-sm shadow-lg motion-safe:transition-transform motion-safe:duration-200 hover:scale-105" style={{ left: `${clamp(item.x)}%`, top: `${100 - clamp(item.y)}%` }}>
            <strong className="block text-[var(--doc-text)]">{item.label}</strong>
            {item.description && <span className="text-xs text-[var(--doc-muted)]">{item.description}</span>}
          </div>
        ))}
      </div>
    </ShowcaseShell>
  )
}

export function BeforeAfterBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as BeforeAfterBlockContent
  const pairs = Array.isArray(content?.pairs) ? content.pairs : []
  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      {pairs.length === 0 ? <EmptyShowcaseState label="before/after pairs" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {pairs.map((pair) => (
            <article key={pair.id} className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5">
              <h3 className="text-lg font-semibold text-[var(--doc-text)]">{pair.label}</h3>
              <dl className="mt-4 grid gap-3">
                <div className="rounded-xl bg-red-500/10 p-4"><dt className="text-xs uppercase tracking-wider text-red-200">Before</dt><dd className="mt-1 text-sm text-[var(--doc-text)]">{pair.before}</dd></div>
                <div className="rounded-xl bg-emerald-500/10 p-4"><dt className="text-xs uppercase tracking-wider text-emerald-200">After</dt><dd className="mt-1 text-sm text-[var(--doc-text)]">{pair.after}</dd></div>
              </dl>
              {pair.evidence && <p className="mt-4 text-xs text-[var(--doc-muted)]">Evidence: {pair.evidence}</p>}
            </article>
          ))}
        </div>
      )}
    </ShowcaseShell>
  )
}

export function RoadmapGanttBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as RoadmapGanttBlockContent
  const items = Array.isArray(content?.items) ? content.items : []
  const dates = items.flatMap((item) => [new Date(item.start), new Date(item.end)]).filter((date) => !Number.isNaN(date.getTime()))
  const min = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : new Date()
  const max = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date(min.getTime() + 86_400_000)
  const span = daysBetween(min, max)

  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      {items.length === 0 ? <EmptyShowcaseState label="roadmap items" /> : (
        <div className="space-y-4" role="list" aria-label={content?.headline || block.title || 'Roadmap timeline'}>
          {items.map((item) => {
            const start = new Date(item.start)
            const end = new Date(item.end)
            const offset = Number.isNaN(start.getTime()) ? 0 : (daysBetween(min, start) / span) * 100
            const width = Number.isNaN(end.getTime()) || Number.isNaN(start.getTime()) ? 100 : (daysBetween(start, end) / span) * 100
            return (
              <div key={item.id} role="listitem" className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-xs uppercase tracking-wider text-[var(--doc-muted)]">{item.lane || 'Timeline'}</p><h3 className="font-semibold text-[var(--doc-text)]">{item.label}</h3></div>
                  <span className="text-xs text-[var(--doc-muted)]">{formatDate(item.start)} – {formatDate(item.end)} · {STATUS_LABEL[item.status || 'planned']}</span>
                </div>
                <div className="mt-4 h-3 rounded-full bg-[var(--doc-border)]" aria-hidden="true"><div className="h-full rounded-full bg-[var(--doc-accent)] motion-safe:transition-all motion-safe:duration-700" style={{ marginLeft: `${clamp(offset)}%`, width: `${clamp(width, 8, 100)}%` }} /></div>
                {item.owner && <p className="mt-2 text-xs text-[var(--doc-muted)]">Owner: {item.owner}</p>}
              </div>
            )
          })}
          {content?.milestones?.length ? <div className="flex flex-wrap gap-2 pt-2">{content.milestones.map((m) => <span key={m.id} className="rounded-full border border-[var(--doc-accent)]/40 px-3 py-1 text-xs text-[var(--doc-accent)]">{m.label}: {formatDate(m.date)}</span>)}</div> : null}
        </div>
      )}
    </ShowcaseShell>
  )
}

export function LogoTestimonialProofBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as LogoTestimonialProofBlockContent
  const proof = Array.isArray(content?.proof) ? content.proof : []
  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      <div className="grid gap-4 md:grid-cols-2">
        {proof.map((item) => (
          <figure key={item.id} className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5">
            {item.logoUrl ? <img src={item.logoUrl} alt={item.organisationName || 'Client logo'} className="mb-4 max-h-12 max-w-40 object-contain" /> : <div className="mb-4 inline-flex rounded-full bg-[var(--doc-accent-soft)] px-3 py-1 text-xs uppercase tracking-wider text-[var(--doc-accent)]">{item.kind}</div>}
            {item.metricValue && <p className="text-3xl font-semibold text-[var(--doc-accent)]">{item.metricValue}</p>}
            {item.metricLabel && <p className="mt-1 text-sm text-[var(--doc-muted)]">{item.metricLabel}</p>}
            {item.quote && <blockquote className="text-lg leading-7 text-[var(--doc-text)]">“{item.quote}”</blockquote>}
            {(item.personName || item.organisationName) && <figcaption className="mt-4 text-sm text-[var(--doc-muted)]">{item.personName || item.organisationName}{item.personRole ? `, ${item.personRole}` : ''}</figcaption>}
          </figure>
        ))}
      </div>
    </ShowcaseShell>
  )
}

export function CaseStudyResultCardsBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as CaseStudyResultCardsBlockContent
  const cards = Array.isArray(content?.cards) ? content.cards : []
  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <article key={card.id} className="pib-card pib-card-hover !p-5">
            {card.imageUrl && <img src={card.imageUrl} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />}
            <p className="text-3xl font-semibold text-[var(--doc-accent)]">{card.result}</p>
            <h3 className="mt-3 text-lg font-semibold text-[var(--doc-text)]">{card.title}</h3>
            {card.narrative && <p className="mt-3 text-sm leading-6 text-[var(--doc-muted)]">{card.narrative}</p>}
            {card.timeframe && <p className="mt-4 text-xs uppercase tracking-wider text-[var(--doc-muted)]">{card.timeframe}</p>}
          </article>
        ))}
      </div>
    </ShowcaseShell>
  )
}

export function WeightedDecisionMatrixBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as WeightedDecisionMatrixBlockContent
  const criteria = Array.isArray(content?.criteria) ? content.criteria : []
  const options = Array.isArray(content?.options) ? content.options : []
  const totals = options.map((option) => ({
    id: option.id,
    total: criteria.reduce((sum, criterion) => sum + (option.scores?.[criterion.id] ?? 0) * criterion.weight, 0),
  }))

  return (
    <ShowcaseShell block={block} index={index} eyebrow={content?.eyebrow} headline={content?.headline} description={content?.description}>
      <div className="overflow-x-auto rounded-2xl border border-[var(--color-card-border)]">
        <table aria-label={content?.headline || block.title || 'Weighted decision matrix'} className="min-w-full divide-y divide-[var(--color-card-border)] bg-[var(--color-card)] text-sm">
          <thead><tr><th scope="col" className="px-4 py-3 text-left font-semibold">Option</th>{criteria.map((criterion) => <th key={criterion.id} scope="col" className="px-4 py-3 text-left font-semibold">{criterion.label} <span className="text-[var(--doc-muted)]">({Math.round(criterion.weight * 100)}%)</span></th>)}<th scope="col" className="px-4 py-3 text-left font-semibold">Weighted score</th></tr></thead>
          <tbody className="divide-y divide-[var(--color-card-border)]">
            {options.map((option) => {
              const total = totals.find((t) => t.id === option.id)?.total ?? 0
              return <tr key={option.id} className={option.recommended ? 'bg-[var(--doc-accent-soft)]' : undefined}><th scope="row" className="px-4 py-3 text-left font-semibold text-[var(--doc-text)]">{option.label}{option.recommended && <span className="ml-2 rounded-full bg-[var(--doc-accent)] px-2 py-0.5 text-[10px] uppercase text-black">Recommended</span>}{option.summary && <span className="mt-1 block text-xs font-normal text-[var(--doc-muted)]">{option.summary}</span>}</th>{criteria.map((criterion) => <td key={criterion.id} className="px-4 py-3 text-[var(--doc-muted)]">{option.scores?.[criterion.id] ?? 0}</td>)}<td className="px-4 py-3 font-semibold text-[var(--doc-accent)]">{total.toFixed(1)}</td></tr>
            })}
          </tbody>
        </table>
      </div>
    </ShowcaseShell>
  )
}
