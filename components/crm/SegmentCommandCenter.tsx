import { Icon } from '@/components/studio'
'use client'

export type SegmentCommandFocus = 'all' | 'needsRefresh' | 'advanced'

export interface SegmentCommandSegment {
  id: string
  name: string
  description?: string
  filters?: {
    tags?: string[]
    capturedFromIds?: string[]
    stage?: string
    type?: string
    source?: string
    behavioral?: unknown[]
    engagement?: unknown
  }
}

interface SegmentCommandCenterProps {
  segments: SegmentCommandSegment[]
  counts: Record<string, number | null>
  search: string
  focus: SegmentCommandFocus
  onSearchChange: (value: string) => void
  onFocusChange: (focus: SegmentCommandFocus) => void
}

export function isAdvancedSegment(segment: SegmentCommandSegment) {
  return Boolean((segment.filters?.behavioral?.length ?? 0) > 0 || segment.filters?.engagement)
}

export function segmentNeedsRefresh(segment: SegmentCommandSegment, counts: Record<string, number | null>) {
  return counts[segment.id] === undefined || counts[segment.id] === null
}

export function matchesSegmentCommandFocus(
  segment: SegmentCommandSegment,
  counts: Record<string, number | null>,
  focus: SegmentCommandFocus,
) {
  if (focus === 'needsRefresh') return segmentNeedsRefresh(segment, counts)
  if (focus === 'advanced') return isAdvancedSegment(segment)
  return true
}

export function matchesSegmentSearch(segment: SegmentCommandSegment, search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return true
  const haystack = [
    segment.name,
    segment.description,
    segment.filters?.stage,
    segment.filters?.type,
    segment.filters?.source,
    ...(segment.filters?.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function SegmentCommandCenter({
  segments,
  counts,
  search,
  focus,
  onSearchChange,
  onFocusChange,
}: SegmentCommandCenterProps) {
  const resolvedContacts = segments.reduce((sum, segment) => {
    const count = counts[segment.id]
    return sum + (typeof count === 'number' ? count : 0)
  }, 0)
  const needsRefresh = segments.filter((segment) => segmentNeedsRefresh(segment, counts)).length
  const advanced = segments.filter(isAdvancedSegment).length

  const cards: Array<{
    focus: SegmentCommandFocus
    label: string
    value: string
    icon: string
    ariaLabel: string
  }> = [
    {
      focus: 'all',
      label: 'Saved audiences',
      value: `${segments.length} saved audience${segments.length === 1 ? '' : 's'}`,
      icon: 'groups',
      ariaLabel: 'Focus all segments',
    },
    {
      focus: 'all',
      label: 'Resolved reach',
      value: `${resolvedContacts} resolved contact${resolvedContacts === 1 ? '' : 's'}`,
      icon: 'person_check',
      ariaLabel: 'Focus all segments',
    },
    {
      focus: 'needsRefresh',
      label: 'Needs refresh',
      value: `${needsRefresh} needs refresh`,
      icon: 'sync_problem',
      ariaLabel: 'Focus segments needing refresh',
    },
    {
      focus: 'advanced',
      label: 'Advanced lenses',
      value: `${advanced} advanced lens${advanced === 1 ? '' : 'es'}`,
      icon: 'filter_alt',
      ariaLabel: 'Focus advanced segments',
    },
  ]

  return (
    <section className="rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/55">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--color-card-border)] px-3">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Segment command center</p>
        <h2 className="truncate text-[11px] text-[var(--color-pib-text-muted)]">Audience reach and targeting quality</h2>
        <div className="ml-auto flex min-w-0 max-w-xs flex-1 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] bg-transparent px-2">
          <Icon name="search" className="text-[var(--color-pib-text-muted)]" />
          <label className="sr-only">Search segments</label>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="Search segments"
            placeholder="Search name, description, tag, stage, type, or source"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-[var(--color-pib-text)] outline-none placeholder:text-[var(--color-pib-text-muted)]"
          />
        </div>
      </div>

      <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const active = focus === card.focus && card.focus !== 'all'
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onFocusChange(card.focus)}
              aria-label={card.ariaLabel}
              className={[
                'rounded-md border px-2 py-2 text-left transition',
                active
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-[var(--color-card-border)] bg-black/10 hover:bg-white/[0.05]',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{card.label}</span>
                <Icon name={card.icon} className="text-[var(--color-pib-text-muted)]" />
              </div>
              <p className={`mt-1 text-xs  ${active ? 'text-primary' : 'text-[var(--color-pib-text)]'}`}>{card.value}</p>
            </button>
          )
        })}
      </div>

      <p className="border-t border-[var(--color-card-border)] px-3 py-1.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
        Use this before editing reusable audiences or launching campaign targeting.
      </p>
    </section>
  )
}
