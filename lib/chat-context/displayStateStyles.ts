import type { ContextDisplayState } from '@/lib/chat-context/types'

/**
 * Visual language shared with the project Kanban board:
 * backlog/ready → outline, todo → blue, in progress → amber accent,
 * blocked → red, review → purple, done → green.
 */
export type DisplayStateStyle = {
  label: string
  /** Left accent / badge text color */
  accent: string
  /** Soft badge/chip surface */
  badgeClassName: string
  /** Soft card border + background */
  cardClassName: string
  /** Solid left rail color (inline style) */
  rail: string
}

const STYLES: Record<ContextDisplayState, DisplayStateStyle> = {
  ready: {
    label: 'Ready',
    accent: 'text-sky-300',
    badgeClassName: 'border-sky-400/25 bg-sky-500/10 text-sky-200',
    cardClassName: 'border-sky-400/20 bg-sky-500/[0.06]',
    rail: '#60a5fa',
  },
  running: {
    label: 'In progress',
    accent: 'text-amber-200',
    badgeClassName: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
    cardClassName: 'border-amber-400/25 bg-amber-500/[0.08]',
    rail: 'var(--color-accent-v2, #f5a623)',
  },
  waiting: {
    label: 'Waiting',
    accent: 'text-[var(--color-pib-text-muted)]',
    badgeClassName: 'border-white/12 bg-white/[0.05] text-[var(--color-pib-text-muted)]',
    cardClassName: 'border-white/10 bg-white/[0.03]',
    rail: 'var(--color-outline, #6b7280)',
  },
  needs_input: {
    label: 'Needs input',
    accent: 'text-orange-200',
    badgeClassName: 'border-orange-400/30 bg-orange-500/15 text-orange-100',
    cardClassName: 'border-orange-400/25 bg-orange-500/[0.08]',
    rail: '#fb923c',
  },
  needs_approval: {
    label: 'Needs approval',
    accent: 'text-orange-200',
    badgeClassName: 'border-orange-400/30 bg-orange-500/15 text-orange-100',
    cardClassName: 'border-orange-400/25 bg-orange-500/[0.08]',
    rail: '#fb923c',
  },
  blocked: {
    label: 'Blocked',
    accent: 'text-red-300',
    badgeClassName: 'border-red-400/30 bg-red-500/15 text-red-100',
    cardClassName: 'border-red-400/25 bg-red-500/[0.08]',
    rail: '#ef4444',
  },
  review: {
    label: 'Review',
    accent: 'text-violet-200',
    badgeClassName: 'border-violet-400/30 bg-violet-500/15 text-violet-100',
    cardClassName: 'border-violet-400/25 bg-violet-500/[0.08]',
    rail: '#c084fc',
  },
  complete: {
    label: 'Complete',
    accent: 'text-emerald-200',
    badgeClassName: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
    cardClassName: 'border-emerald-400/25 bg-emerald-500/[0.07]',
    rail: '#4ade80',
  },
  published: {
    label: 'Published',
    accent: 'text-emerald-200',
    badgeClassName: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
    cardClassName: 'border-emerald-400/25 bg-emerald-500/[0.07]',
    rail: '#4ade80',
  },
  archived: {
    label: 'Archived',
    accent: 'text-[var(--color-pib-text-muted)]',
    badgeClassName: 'border-white/10 bg-white/[0.04] text-[var(--color-pib-text-muted)]',
    cardClassName: 'border-white/10 bg-white/[0.02]',
    rail: 'var(--color-outline, #6b7280)',
  },
}

export function displayStateStyle(state: ContextDisplayState | string | undefined): DisplayStateStyle {
  if (state && state in STYLES) return STYLES[state as ContextDisplayState]
  return STYLES.ready
}

export function displayStateLabel(state: ContextDisplayState | string | undefined): string {
  return displayStateStyle(state).label
}
