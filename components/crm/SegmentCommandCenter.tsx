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
    <section className="pib-card-section overflow-hidden">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">Segment command center</p>
            <h2 className="mt-1 text-xl font-headline font-semibold text-on-surface">Audience reach and targeting quality</h2>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => {
              const active = focus === card.focus && card.focus !== 'all'
              return (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => onFocusChange(card.focus)}
                  aria-label={card.ariaLabel}
                  className={[
                    'min-h-[72px] rounded-lg border px-3 py-2 text-left transition-colors',
                    active
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/10'
                      : 'border-[var(--color-pib-line)] bg-white/[0.02] hover:bg-white/[0.05]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{card.label}</span>
                    <span className="material-symbols-outlined text-[17px] text-on-surface-variant">{card.icon}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-on-surface">{card.value}</p>
                </button>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Search segments</span>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2">
            <span className="material-symbols-outlined text-[17px] text-on-surface-variant">search</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search segments"
              placeholder="Search name, description, tag, stage, type, or source"
              className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">
            Use this before editing reusable audiences or launching campaign targeting.
          </p>
        </label>
      </div>
    </section>
  )
}
