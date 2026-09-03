'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/studio'
import type { BriefingCard } from '../cockpit/cockpitTypes'
import type { BriefingWorkKind } from '@/lib/briefing/workKind'
import { snoozeOptionsForKind } from './snooze'

export const CARD_PRIMARY_CLASS = 'pib-btn-primary min-w-0 flex-1 justify-center px-3 py-2 text-xs'
export const CARD_SECONDARY_CLASS = 'pib-btn-secondary min-w-0 flex-1 justify-center px-3 py-2 text-xs'
export const CARD_ICON_BUTTON_CLASS = 'pib-btn-secondary shrink-0 justify-center px-3 py-2 text-xs'

export function accentForKind(kind: BriefingWorkKind, priority: BriefingCard['priority']): string {
  if (priority === 'critical') return '#ef4444'
  switch (kind) {
    case 'meeting':
      return '#10b981'
    case 'reply':
      return '#60a5fa'
    case 'approval':
      return 'var(--color-accent-v2)'
    case 'agent':
      return '#a78bfa'
    case 'blocked':
      return '#f97316'
    default:
      return 'var(--color-pib-line)'
  }
}

export function Pill({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info'; className?: string }) {
  const toneClass = tone === 'ok'
    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
    : tone === 'warn'
      ? 'border-amber-400/50 text-amber-600 dark:text-amber-300'
      : tone === 'danger'
        ? 'border-red-400/50 text-red-600 dark:text-red-300'
        : tone === 'info'
          ? 'border-sky-400/50 text-sky-600 dark:text-sky-300'
          : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]'
  return <span className={`inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] ${toneClass} ${className}`}>{children}</span>
}

export function Fact({ label, value, href }: { label: string; value: string | null | undefined; href?: string | null }) {
  if (!value) return null
  return (
    <span className="max-w-full truncate rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-0.5 text-[10px] text-[var(--color-pib-text)]">
      <span className="text-[var(--color-pib-text-muted)]">{label}:</span>{' '}
      {href ? <a href={href} className="underline underline-offset-2" onClick={(event) => event.stopPropagation()}>{value}</a> : value}
    </span>
  )
}

export type CardFrameProps = {
  item: BriefingCard
  kind: BriefingWorkKind
  eyebrowIcon: string
  eyebrow: ReactNode
  /** Optional replacement for item.title. */
  title?: string
  children?: ReactNode
  /** Action row content (primary + secondary buttons). */
  actions?: ReactNode
  busy: boolean
  onSelect: (item: BriefingCard) => void
  /** Default snooze (24h). */
  onSnooze: (item: BriefingCard) => void
  /** Snooze until a specific ISO datetime chosen from the menu. */
  onSnoozeUntil: (item: BriefingCard, untilIso: string) => void
  onMore: (item: BriefingCard) => void
  /** Meeting start (ISO) so the menu can offer "1 hour before". */
  meetingStartIso?: string | null
}

function SnoozeMenu({ item, kind, busy, meetingStartIso, onSnooze, onSnoozeUntil }: Pick<CardFrameProps, 'item' | 'kind' | 'busy' | 'meetingStartIso' | 'onSnooze' | 'onSnoozeUntil'>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const options = open ? snoozeOptionsForKind(kind, new Date(), meetingStartIso) : []
  const itemClass = 'block w-full whitespace-nowrap rounded px-2 py-1.5 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)]'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={CARD_ICON_BUTTON_CLASS}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        disabled={busy}
        title="Snooze"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="snooze" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Snooze until"
          className="absolute bottom-full right-0 z-20 mb-1 min-w-[10rem] rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={itemClass}
              title={option.until.toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
              onClick={() => {
                setOpen(false)
                onSnoozeUntil(item, option.until.toISOString())
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} ${options.length ? 'border-t border-[var(--color-pib-line)] rounded-t-none' : ''}`}
            onClick={() => {
              setOpen(false)
              onSnooze(item)
            }}
          >
            24 hours
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function CardFrame({ item, kind, eyebrowIcon, eyebrow, title, children, actions, busy, onSelect, onSnooze, onSnoozeUntil, onMore, meetingStartIso }: CardFrameProps) {
  return (
    <article
      data-testid="briefing-card"
      data-work-kind={kind}
      className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3 transition hover:bg-[var(--color-pib-surface-muted)]"
      style={{ borderLeft: `3px solid ${accentForKind(kind, item.priority)}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="block min-w-0 flex-1 text-left" onClick={() => onSelect(item)}>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            <Icon name={eyebrowIcon} className="text-[13px]" />
            <span className="truncate">{eyebrow}</span>
          </p>
          <p data-testid="briefing-card-title" className="mt-0.5 break-words text-sm leading-5 text-[var(--color-pib-text)]">{title ?? item.title}</p>
        </button>
        {item.timeAgo ? <span className="shrink-0 pt-0.5 text-[10px] text-[var(--color-pib-text-muted)]">{item.timeAgo}</span> : null}
      </div>

      {children}

      <div className="mt-3 flex items-center gap-2">
        {actions}
        <SnoozeMenu item={item} kind={kind} busy={busy} meetingStartIso={meetingStartIso} onSnooze={onSnooze} onSnoozeUntil={onSnoozeUntil} />
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--color-pib-line)] px-2 py-2 text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
          onClick={(event) => {
            event.stopPropagation()
            onMore(item)
          }}
          title="More actions"
        >
          <Icon name="more_horiz" />
        </button>
      </div>
    </article>
  )
}
