'use client'

// US-101 — interactive Email Programs section: status filter, "New campaign"
// button, recipients badge, and delete-draft with confirmation.
//
// Split out of CampaignsWorkspace (a server component) so the interactive
// pieces live behind a client boundary. The parent precomputes each campaign's
// href (server-side, scope-aware) and passes serialisable items only.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CampaignWorkspaceRecord } from '@/components/campaigns/CampaignsWorkspace'

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  scheduled: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  active: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  sending: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  paused: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  completed: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
}

const EMAIL_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
]

function statusPill(status?: string | null): string {
  return STATUS_PILL[status ?? ''] ?? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
}
function numeric(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
function pct(num: number, denom: number): string {
  if (!denom) return '-'
  return `${((num / denom) * 100).toFixed(1)}%`
}
function formatDate(value: unknown): string {
  if (!value) return '-'
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? '-' : new Date(parsed).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  }
  if (typeof value === 'object' && value !== null) {
    const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const date =
      ts.toDate?.() ??
      (typeof (ts.seconds ?? ts._seconds) === 'number' ? new Date((ts.seconds ?? ts._seconds)! * 1000) : null)
    return date ? date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '-'
  }
  return '-'
}
function campaignTitle(record: CampaignWorkspaceRecord): string {
  return record.name ?? record.title ?? 'Untitled campaign'
}

// Recipient badge: post-launch we show enrolled count; pre-launch we show the
// explicit contact-list size or a "Segment"/"Tag" hint (real size resolves in
// the review panel via the recipients API).
function recipientLabel(campaign: CampaignWorkspaceRecord): string {
  const enrolled = numeric((campaign.stats ?? {}).enrolled)
  if (enrolled > 0) return enrolled.toLocaleString('en-ZA')
  if (campaign.segmentId) return 'Segment'
  const contactIds = Array.isArray(campaign.contactIds) ? campaign.contactIds : []
  if (contactIds.length > 0) return contactIds.length.toLocaleString('en-ZA')
  if (typeof campaign.tagId === 'string' && campaign.tagId) return 'Tag'
  return '—'
}

export interface EmailProgramItem {
  campaign: CampaignWorkspaceRecord
  href: string
}

export function EmailProgramsSection({
  items,
  surface,
  newEmailCampaignHref,
  enableCampaignDelete,
}: {
  items: EmailProgramItem[]
  surface: 'admin' | 'portal'
  newEmailCampaignHref?: string
  enableCampaignDelete?: boolean
}) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return items
    return items.filter((it) => (it.campaign.status ?? 'draft') === statusFilter)
  }, [items, statusFilter])

  async function doDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/campaigns/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => null)
        alert((body && (body.error as string)) || 'Failed to delete campaign.')
      }
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Campaign workspace</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold tracking-tight mt-2">Email Programs</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-2xl">
            Sequence-backed campaigns linked to CRM segments and contacts.
          </p>
        </div>
        {newEmailCampaignHref && (
          <Link href={newEmailCampaignHref} className="btn-pib-primary whitespace-nowrap">
            <span className="material-symbols-outlined text-base">add</span>
            New campaign
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {EMAIL_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={[
              'px-3 py-1.5 rounded-full text-xs border transition-colors',
              statusFilter === f.value
                ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)] border-[var(--color-pib-accent)]'
                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">forward_to_inbox</span>
          <h3 className="font-headline text-lg font-semibold mt-3">
            {items.length === 0 ? 'No email programs yet' : 'Nothing matches this filter'}
          </h3>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">
            {items.length === 0
              ? surface === 'admin'
                ? 'Use quick create to start a draft email campaign.'
                : 'Create your first campaign to get started.'
              : 'Try a different status.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(({ campaign, href }) => (
            <EmailCampaignCard
              key={campaign.id}
              campaign={campaign}
              href={href}
              canDelete={
                Boolean(enableCampaignDelete) &&
                campaign.kind !== 'sequence' &&
                (campaign.status ?? 'draft') === 'draft'
              }
              deleting={deletingId === campaign.id}
              confirming={confirmId === campaign.id}
              onRequestDelete={() => setConfirmId(campaign.id)}
              onCancelDelete={() => setConfirmId(null)}
              onConfirmDelete={() => doDelete(campaign.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function EmailCampaignCard({
  campaign,
  href,
  canDelete,
  deleting,
  confirming,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  campaign: CampaignWorkspaceRecord
  href: string
  canDelete?: boolean
  deleting?: boolean
  confirming?: boolean
  onRequestDelete?: () => void
  onCancelDelete?: () => void
  onConfirmDelete?: () => void
}) {
  const stats = campaign.stats ?? {}
  const opened = numeric(stats.opened)
  const clicked = numeric(stats.clicked)
  const delivered = numeric(stats.delivered ?? stats.sent)

  return (
    <div className="pib-card pib-card-hover !p-5 relative">
      <Link href={href} className="block">
        <div className="flex items-start justify-between gap-3">
          <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(campaign.status)}`}>
            {campaign.status ?? 'draft'}
          </span>
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">forward_to_inbox</span>
        </div>
        <h3 className="font-headline text-lg font-semibold mt-4 leading-tight">{campaignTitle(campaign)}</h3>
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
          {campaign.description || 'Sequence-driven email program'}
        </p>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--color-pib-line)] text-xs">
          <MiniStat label="Recipients" value={recipientLabel(campaign)} />
          <MiniStat label="Open" value={pct(opened, delivered)} />
          <MiniStat label="Click" value={pct(clicked, delivered)} />
        </div>
        <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-3">
          Last activity: {formatDate(campaign.updatedAt ?? campaign.createdAt)}
        </p>
      </Link>
      {canDelete && (
        <div className="mt-3 pt-3 border-t border-[var(--color-pib-line)]">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-pib-text-muted)] flex-1">Delete this draft?</span>
              <button
                onClick={onConfirmDelete}
                disabled={deleting}
                className="text-xs px-2 py-1 rounded bg-rose-600/20 text-rose-300 border border-rose-600/40 hover:bg-rose-600/30 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={onCancelDelete}
                disabled={deleting}
                className="text-xs px-2 py-1 rounded border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onRequestDelete}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-rose-300"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
              Delete draft
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="font-medium text-sm tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
